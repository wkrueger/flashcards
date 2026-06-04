import ExcelJS from "exceljs"

export type SpreadsheetRow = {
  rowNumber: number
  id: string
  subjectName: string
  subjectOrder: number | null
  front: string
  back: string
  cardOrder: number | null
  tagNames: string[]
}

export const CARD_HEADERS = [
  "id",
  "subjectName",
  "subjectOrder",
  "front",
  "back",
  "cardOrder",
  "tags",
] as const

export function readMetaDeckId(workbook: ExcelJS.Workbook) {
  const worksheet = getRequiredWorksheet(workbook, "Meta")
  const headers = headerMap(worksheet)
  const keyColumn = requiredHeader(headers, "key")
  const valueColumn = requiredHeader(headers, "value")

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    if (cellText(row, keyColumn) === "deckId") {
      const deckId = cellText(row, valueColumn)
      if (!deckId) throw new Error("Meta deckId cannot be empty.")
      return deckId
    }
  }

  throw new Error("Meta worksheet must contain a deckId row.")
}

export function readCardRows(workbook: ExcelJS.Workbook) {
  const worksheet = getRequiredWorksheet(workbook, "Card")
  const headers = headerMap(worksheet)
  const columns = Object.fromEntries(
    CARD_HEADERS.map((header) => [header, requiredHeader(headers, header)])
  ) as Record<(typeof CARD_HEADERS)[number], number>
  const rows: SpreadsheetRow[] = []

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const id = cellText(row, columns.id)
    const subjectName = cellText(row, columns.subjectName)
    const subjectOrder = cellText(row, columns.subjectOrder)
    const front = cellText(row, columns.front)
    const back = cellText(row, columns.back)
    const cardOrder = cellText(row, columns.cardOrder)
    const tags = cellText(row, columns.tags)

    if (!id && !subjectName && !subjectOrder && !front && !back && !cardOrder && !tags) continue

    rows.push({
      rowNumber,
      id,
      subjectName,
      subjectOrder: parseOrderCell(subjectOrder, rowNumber, "subjectOrder"),
      front,
      back,
      cardOrder: parseOrderCell(cardOrder, rowNumber, "cardOrder"),
      tagNames: tags.trim()
        ? tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
    })
  }

  return rows
}

export function assertNoDuplicateTagNames(tags: Array<{ id: string; name: string }>) {
  const byName = new Map<string, string>()

  for (const tag of tags) {
    const existingId = byName.get(tag.name)
    if (existingId && existingId !== tag.id) {
      throw new Error(`Multiple tags named "${tag.name}" were found.`)
    }
    byName.set(tag.name, tag.id)
  }
}

export const META_CONFIG_KEYS = {
  deckId: "deckId",
  name: "name",
  defaultFrontLanguage: "defaultFrontLanguage",
  defaultBackLanguage: "defaultBackLanguage",
  speechRecognitionEnabled: "speechRecognitionEnabled",
  inverseReviewEnabled: "inverseReviewEnabled",
  sequentialEnabled: "sequentialEnabled",
} as const

export type MetaConfig = {
  deckId: string
  name: string
  defaultFrontLanguage: string
  defaultBackLanguage: string
  speechRecognitionEnabled: boolean
  inverseReviewEnabled: boolean
  sequentialEnabled: boolean
}

export function readMetaConfig(workbook: ExcelJS.Workbook): MetaConfig {
  const worksheet = getRequiredWorksheet(workbook, "Meta")
  const headers = headerMap(worksheet)
  const keyColumn = requiredHeader(headers, "key")
  const valueColumn = requiredHeader(headers, "value")

  const values = new Map<string, string>()
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const key = cellText(row, keyColumn)
    if (key) values.set(key, cellText(row, valueColumn))
  }

  return {
    deckId: values.get(META_CONFIG_KEYS.deckId) ?? "",
    name: values.get(META_CONFIG_KEYS.name) ?? "",
    defaultFrontLanguage: values.get(META_CONFIG_KEYS.defaultFrontLanguage) ?? "",
    defaultBackLanguage: values.get(META_CONFIG_KEYS.defaultBackLanguage) ?? "",
    speechRecognitionEnabled: parseMetaBool(
      values.get(META_CONFIG_KEYS.speechRecognitionEnabled),
      true
    ),
    inverseReviewEnabled: parseMetaBool(values.get(META_CONFIG_KEYS.inverseReviewEnabled), false),
    sequentialEnabled: parseMetaBool(values.get(META_CONFIG_KEYS.sequentialEnabled), false),
  }
}

function parseMetaBool(raw: string | undefined, fallback: boolean): boolean {
  const value = (raw ?? "").trim().toLowerCase()
  if (!value) return fallback
  if (["true", "1", "yes", "y"].includes(value)) return true
  if (["false", "0", "no", "n"].includes(value)) return false
  throw new Error(`Meta value "${raw}" must be true or false.`)
}

function parseOrderCell(text: string, rowNumber: number, column: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isInteger(value)) {
    throw new Error(`Row ${rowNumber}: ${column} must be a whole number.`)
  }
  return value
}

function cellText(row: ExcelJS.Row, column: number) {
  return row.getCell(column).text.trim()
}

function getRequiredWorksheet(workbook: ExcelJS.Workbook, name: string) {
  const worksheet = workbook.getWorksheet(name)
  if (!worksheet) {
    throw new Error(`Worksheet "${name}" is required.`)
  }
  return worksheet
}

function headerMap(worksheet: ExcelJS.Worksheet) {
  const headers = new Map<string, number>()
  worksheet.getRow(1).eachCell((cell, column) => {
    headers.set(cell.text.trim(), column)
  })
  return headers
}

function requiredHeader(headers: Map<string, number>, name: string) {
  const column = headers.get(name)
  if (!column) {
    throw new Error(`Column "${name}" is required.`)
  }
  return column
}
