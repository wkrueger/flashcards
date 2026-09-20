import { test, expect } from "@playwright/test"
import AdmZip from "adm-zip"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const CHAPTERS = [
  { title: "Chapter One", paragraphs: ["The first page of the first chapter begins right here."] },
  { title: "Chapter Two", paragraphs: ["The second chapter picks the story up again."] },
]

function writeEpubFixture() {
  const zip = new AdmZip()
  zip.addFile("mimetype", Buffer.from("application/epub+zip"))
  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    )
  )

  CHAPTERS.forEach((chapter, i) => {
    zip.addFile(
      `OEBPS/chapter-${i + 1}.xhtml`,
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter.title}</title></head><body><h1>${chapter.title}</h1>${chapter.paragraphs
          .map((p) => `<p>${p}</p>`)
          .join("")}</body></html>`
      )
    )
  })

  zip.addFile(
    "OEBPS/content.opf",
    Buffer.from(
      `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>E2E Reader Book</dc:title><dc:creator>E2E Author</dc:creator><dc:language>de</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${CHAPTERS.map(
        (_, i) =>
          `<item id="ch${i + 1}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`
      ).join("")}</manifest><spine toc="ncx">${CHAPTERS.map(
        (_, i) => `<itemref idref="ch${i + 1}"/>`
      ).join("")}</spine></package>`
    )
  )

  zip.addFile(
    "OEBPS/toc.ncx",
    Buffer.from(
      `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${CHAPTERS.map(
        (chapter, i) =>
          `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${chapter.title}</text></navLabel><content src="chapter-${i + 1}.xhtml"/></navPoint>`
      ).join("")}</navMap></ncx>`
    )
  )

  const dir = mkdtempSync(path.join(tmpdir(), "cards-e2e-epub-"))
  const filePath = path.join(dir, "e2e-reader-book.epub")
  writeFileSync(filePath, zip.toBuffer())
  return filePath
}

test("signup → import epub → read with translation → bookmark → progress", async ({ page }) => {
  const email = `e2e-epub-${Date.now()}@test.local`
  const password = "passw0rd!"

  await page.goto("/signup")
  await page.getByLabel("Name").fill("E2E Reader")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign up" }).click()

  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Log in" }).click()
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible()

  // Import the book from the home menu.
  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Import EPUB" }).click()
  await page.setInputFiles("#epub-file", writeEpubFixture())
  await page.getByRole("button", { name: "Upload" }).click()

  // The worker parses in the background; the detail page polls until it is ready.
  await expect(page.getByRole("heading", { name: "E2E Reader Book" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Continue reading" })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText("Chapter One").first()).toBeVisible()

  // The home list shows it as a book.
  await page.goto("/")
  // Home rows are drag-sortable, so dnd-kit gives the link role="button".
  const bookRow = page.getByRole("button", { name: /E2E Reader Book/ })
  await expect(bookRow).toBeVisible()
  await expect(bookRow.locator('svg[aria-label="Book"]')).toBeVisible()

  await bookRow.click()
  await page.getByRole("link", { name: "Continue reading" }).click()

  // Page 1: original on top, translation only after Reveal.
  await expect(page.getByText("1 / 2")).toBeVisible()
  await expect(page.getByText("The first page of the first chapter")).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByText("(Portuguese)")).toBeVisible({ timeout: 20_000 })

  // Advancing is never blocked.
  await page.getByRole("button", { name: "Next" }).click()
  await expect(page.getByText("2 / 2")).toBeVisible()
  await expect(page.getByText("The second chapter picks the story up")).toBeVisible()

  // Bookmark the page from the reader menu.
  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Add bookmark" }).click()
  await page.getByLabel("Name").fill("My spot")
  await page.getByRole("button", { name: /Bookmark page 2/ }).click()

  // Finishing returns to the book, with progress and the bookmark recorded.
  await page.getByRole("button", { name: "Reveal" }).click()
  await page.getByRole("button", { name: "Finish" }).click()
  await expect(page.getByText("2 / 2 · 100%")).toBeVisible()
  await expect(page.getByText("My spot")).toBeVisible()
})
