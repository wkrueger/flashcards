import AdmZip from "adm-zip"

export interface EpubFixtureChapter {
  title: string
  paragraphs: string[]
}

// Builds a minimal but spec-shaped EPUB 2 (container.xml + OPF + NCX) in memory,
// so the parser tests don't need a binary fixture checked into the repo.
export function buildEpubFixture(input: {
  title: string
  author?: string
  language?: string
  chapters: EpubFixtureChapter[]
}) {
  const zip = new AdmZip()
  zip.addFile("mimetype", Buffer.from("application/epub+zip"))
  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
    )
  )

  input.chapters.forEach((chapter, i) => {
    const body = chapter.paragraphs.map((p) => `<p>${p}</p>`).join("\n")
    zip.addFile(
      `OEBPS/chapter-${i + 1}.xhtml`,
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter.title}</title></head>
<body><h1>${chapter.title}</h1>
${body}
</body></html>`
      )
    )
  })

  const manifest = input.chapters
    .map(
      (_, i) =>
        `<item id="ch${i + 1}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`
    )
    .join("\n    ")
  const spine = input.chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join("\n    ")

  zip.addFile(
    "OEBPS/content.opf",
    Buffer.from(
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${input.title}</dc:title>
    <dc:creator>${input.author ?? "Anonymous"}</dc:creator>
    <dc:language>${input.language ?? "en"}</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifest}
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
</package>`
    )
  )

  const navPoints = input.chapters
    .map(
      (chapter, i) =>
        `<navPoint id="np${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${chapter.title}</text></navLabel>
      <content src="chapter-${i + 1}.xhtml"/>
    </navPoint>`
    )
    .join("\n    ")

  zip.addFile(
    "OEBPS/toc.ncx",
    Buffer.from(
      `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <docTitle><text>${input.title}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`
    )
  )

  return zip.toBuffer()
}

export function loremParagraph(seed: string, sentences = 6) {
  return Array.from(
    { length: sentences },
    (_, i) => `${seed} sentence number ${i + 1} carries a little bit of prose for the reader.`
  ).join(" ")
}
