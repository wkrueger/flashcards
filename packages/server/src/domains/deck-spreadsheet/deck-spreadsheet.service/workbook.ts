import ExcelJS from "exceljs"

export type SpreadsheetRow = {
  rowNumber: number
  id: string
  subjectName: string
  front: string
  back: string
  tagNames: string[]
}

export const CARD_HEADERS = ["id", "subjectName", "front", "back", "tags"] as const

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
    const front = cellText(row, columns.front)
    const back = cellText(row, columns.back)
    const tags = cellText(row, columns.tags)

    if (!id && !subjectName && !front && !back && !tags) continue

    rows.push({
      rowNumber,
      id,
      subjectName,
      front,
      back,
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
