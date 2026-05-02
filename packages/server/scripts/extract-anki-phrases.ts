import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import AdmZip from "adm-zip"
import Database from "better-sqlite3"
import { cac } from "cac"

const FIELD_SEPARATOR = "\u001f"

type NoteModel = {
  id: number
  flds: Array<{
    name: string
    ord: number
  }>
}

type NoteRow = {
  id: number
  mid: number
  flds: string
}

type PhrasePair = {
  front: string
  back: string
  base_e: string
  base_d: string
  full_d: string
  artikel_d: string
  plural_d: string
}

function expandPath(inputPath: string, baseDirectory: string) {
  if (inputPath === "~") {
    return homedir()
  }

  if (inputPath.startsWith("~/")) {
    return join(homedir(), inputPath.slice(2))
  }

  return resolve(baseDirectory, inputPath)
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
}

function stripMediaAndMarkup(value: string) {
  return decodeHtmlEntities(
    value
      .replaceAll(/\[sound:[^\]]+\]/g, " ")
      .replaceAll(/<img\b[^>]*>/gi, " ")
      .replaceAll(/<audio\b[^>]*>.*?<\/audio>/gis, " ")
      .replaceAll(/<video\b[^>]*>.*?<\/video>/gis, " ")
      .replaceAll(/<source\b[^>]*>/gi, " ")
      .replaceAll(/<br\s*\/?>/gi, "\n")
      .replaceAll(/<\/div>/gi, "\n")
      .replaceAll(/<\/p>/gi, "\n")
      .replaceAll(/<[^>]+>/g, " ")
  )
    .replaceAll(/\r\n/g, "\n")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .replaceAll(/[ \t]{2,}/g, " ")
    .trim()
}

function getFieldNamesByModel(models: Record<string, NoteModel>) {
  return new Map(
    Object.values(models).map((model) => [
      String(model.id),
      [...model.flds].sort((left, right) => left.ord - right.ord).map((field) => field.name),
    ])
  )
}

function extractPhrasePairs(note: NoteRow, fieldNames: string[]): PhrasePair[] {
  const translationFields = new Set(fieldNames)
  const values = note.flds.split(FIELD_SEPARATOR)
  const fields = Object.fromEntries(fieldNames.map((name, index) => [name, values[index] ?? ""]))
  const metadata = {
    base_e: stripMediaAndMarkup(fields.base_e ?? ""),
    base_d: stripMediaAndMarkup(fields.base_d ?? ""),
    full_d: stripMediaAndMarkup(fields.full_d ?? ""),
    artikel_d: stripMediaAndMarkup(fields.artikel_d ?? ""),
    plural_d: stripMediaAndMarkup(fields.plural_d ?? ""),
  }
  const pairs: PhrasePair[] = []

  for (const fieldName of fieldNames) {
    if (!/^s\d+$/.test(fieldName)) {
      continue
    }

    const translationFieldName = `${fieldName}e`

    if (!translationFields.has(translationFieldName)) {
      continue
    }

    const front = stripMediaAndMarkup(fields[fieldName] ?? "")
    const back = stripMediaAndMarkup(fields[translationFieldName] ?? "")

    if (!front || !back) {
      continue
    }

    pairs.push({
      front,
      back,
      ...metadata,
    })
  }

  return pairs
}

async function extractCollectionDatabase(inputPath: string, tempDirectory: string) {
  const archive = new AdmZip(inputPath)
  const collectionEntry = archive.getEntry("collection.anki2")

  if (!collectionEntry) {
    throw new Error("The .apkg file does not contain collection.anki2")
  }

  const databasePath = join(tempDirectory, "collection.anki2")
  await writeFile(databasePath, collectionEntry.getData())
  return databasePath
}

async function main() {
  const cli = cac("extract-anki-phrases")

  cli
    .option("--input <file>", "Path to the Anki .apkg file")
    .option("--output <file>", "Path to the output JSON file")
    .help()
    .example(
      "pnpm extract:anki-phrases --input ~/Downloads/B1_Wortliste.apkg --output ./tmp/phrases.json"
    )

  const parsed = cli.parse(process.argv, { run: false })
  const options = parsed.options as {
    input?: string
    output?: string
  }

  if (!options.input || !options.output) {
    cli.outputHelp()
    process.exit(1)
  }

  const invocationDirectory = process.env.INIT_CWD ?? process.cwd()
  const inputPath = expandPath(options.input, invocationDirectory)
  const outputPath = expandPath(options.output, invocationDirectory)
  const workingDirectory = await mkdtemp(join(tmpdir(), "anki-import-"))
  let database: Database.Database | null = null

  try {
    const databasePath = await extractCollectionDatabase(inputPath, workingDirectory)
    database = new Database(databasePath, { readonly: true })

    const modelsRow = database.prepare("select models from col limit 1").get() as
      | { models: string }
      | undefined

    if (!modelsRow) {
      throw new Error("Could not read note models from collection.anki2")
    }

    const notes = database.prepare("select id, mid, flds from notes order by id").all() as NoteRow[]
    const modelFieldNames = getFieldNamesByModel(
      JSON.parse(modelsRow.models) as Record<string, NoteModel>
    )
    const seen = new Set<string>()
    const phrases: PhrasePair[] = []

    for (const note of notes) {
      const fieldNames = modelFieldNames.get(String(note.mid))

      if (!fieldNames) {
        continue
      }

      for (const pair of extractPhrasePairs(note, fieldNames)) {
        const key = [
          pair.front,
          pair.back,
          pair.base_e,
          pair.base_d,
          pair.full_d,
          pair.artikel_d,
          pair.plural_d,
        ].join("\u0000")

        if (seen.has(key)) {
          continue
        }

        seen.add(key)
        phrases.push(pair)
      }
    }

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(phrases, null, 2)}\n`, "utf8")

    console.log(`Extracted ${phrases.length} phrase pairs to ${outputPath}`)
  } finally {
    database?.close()
    await rm(workingDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
