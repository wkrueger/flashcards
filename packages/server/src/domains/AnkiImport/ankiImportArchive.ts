import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import AdmZip from "adm-zip"
import Database from "better-sqlite3"
import type { AnkiImportPreviewCard } from "@cards/shared"
import {
  FIELD_SEPARATOR,
  stripMediaAndMarkup,
  type AnkiArchiveData,
  type AnkiArchiveRow,
  type AnkiModelDefinition,
} from "./ankiImportShared.js"

async function extractCollectionDatabase(archivePath: string, tempDirectory: string) {
  const archive = new AdmZip(archivePath)
  const collectionEntry =
    archive.getEntry("collection.anki21") ?? archive.getEntry("collection.anki2")

  if (!collectionEntry) {
    throw new Error("The .apkg file does not contain collection.anki21 or collection.anki2.")
  }

  const databasePath = join(tempDirectory, basename(collectionEntry.entryName))
  await writeFile(databasePath, collectionEntry.getData())

  return {
    collectionFile: collectionEntry.entryName,
    databasePath,
  }
}

function getFieldNamesByModel(
  models: Record<
    string,
    { id: number; name: string; type: number; flds: Array<{ name: string; ord: number }> }
  >
) {
  return new Map(
    Object.values(models).map((model) => [
      String(model.id),
      {
        key: String(model.id),
        name: model.name,
        kind: model.type === 1 ? "CLOZE" : "BASIC",
        fieldNames: [...model.flds]
          .sort((left, right) => left.ord - right.ord)
          .map((field) => field.name),
      } satisfies AnkiModelDefinition,
    ])
  )
}

function parseNoteFields(rawFields: string, fieldNames: string[]) {
  const values = rawFields.split(FIELD_SEPARATOR)
  return Object.fromEntries(fieldNames.map((name, index) => [name, values[index] ?? ""]))
}

export async function readAnkiArchiveData(archivePath: string): Promise<AnkiArchiveData> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "anki-import-"))
  let database: Database.Database | null = null

  try {
    const { collectionFile, databasePath } = await extractCollectionDatabase(
      archivePath,
      tempDirectory
    )
    database = new Database(databasePath, { readonly: true })

    const modelsRow = database.prepare("select models from col limit 1").get() as
      | { models: string }
      | undefined

    if (!modelsRow) {
      throw new Error("Could not read note models from the Anki collection.")
    }

    const models = getFieldNamesByModel(
      JSON.parse(modelsRow.models) as Record<
        string,
        { id: number; name: string; type: number; flds: Array<{ name: string; ord: number }> }
      >
    )

    const rowsByModelKey = new Map<string, AnkiArchiveRow[]>(
      [...models.keys()].map((modelKey) => [modelKey, []])
    )

    const notes = database.prepare("select id, mid, flds from notes order by id").all() as Array<{
      id: number
      mid: number
      flds: string
    }>

    for (const note of notes) {
      const model = models.get(String(note.mid))
      if (!model) continue

      const rows = rowsByModelKey.get(model.key)
      if (!rows) continue

      rows.push({
        noteId: note.id,
        values: parseNoteFields(note.flds, model.fieldNames),
      })
    }

    return {
      collectionFile,
      models,
      rowsByModelKey,
    }
  } finally {
    database?.close()
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

export function mapPreviewCard(
  sampleRow: Record<string, string>,
  mapping: {
    subjectField: string
    frontField: string
    backField: string
  }
): AnkiImportPreviewCard {
  return {
    subjectText: stripMediaAndMarkup(sampleRow[mapping.subjectField] ?? ""),
    front: stripMediaAndMarkup(sampleRow[mapping.frontField] ?? ""),
    back: stripMediaAndMarkup(sampleRow[mapping.backField] ?? ""),
  }
}
