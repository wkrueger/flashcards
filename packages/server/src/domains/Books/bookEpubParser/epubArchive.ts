import AdmZip from "adm-zip"
import { XMLParser } from "fast-xml-parser"
import { posix } from "node:path"

import { BookError } from "../bookShared.js"

export interface EpubSpineEntry {
  id: string
  path: string
}

export interface EpubTocEntry {
  title: string
  path: string
}

export interface EpubArchive {
  title: string
  author: string | null
  language: string | null
  spine: EpubSpineEntry[]
  toc: EpubTocEntry[]
  readText(path: string): string
}

const CONTAINER_PATH = "META-INF/container.xml"

// removeNSPrefix folds `dc:title` into `title` and `epub:type` into `type`, so
// the readers below don't have to care which namespace prefix the file picked.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
})

export function openEpubArchive(buffer: Buffer): EpubArchive {
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch {
    throw new BookError("UNSUPPORTED", "The uploaded file is not a readable EPUB archive.")
  }

  const readText = (path: string) => {
    const entry = zip.getEntry(path)
    if (!entry) throw new BookError("UNSUPPORTED", `The EPUB is missing "${path}".`)
    return entry.getData().toString("utf8")
  }
  const hasEntry = (path: string) => zip.getEntry(path) != null

  const opfPath = readOpfPath(readText)
  const opfDir = posix.dirname(opfPath)
  const opf = parser.parse(readText(opfPath))
  const pkg = opf?.package
  if (!pkg) throw new BookError("UNSUPPORTED", "The EPUB package file is malformed.")

  const manifest = readManifest(pkg, opfDir)
  const spine = readSpine(pkg, manifest).filter((entry) => hasEntry(entry.path))
  if (spine.length === 0) {
    throw new BookError("UNSUPPORTED", "The EPUB has no readable content documents.")
  }

  return {
    ...readMetadata(pkg),
    spine,
    toc: readToc({ pkg, manifest, readText, hasEntry }),
    readText,
  }
}

function readOpfPath(readText: (path: string) => string) {
  const container = parser.parse(readText(CONTAINER_PATH))
  const rootfile = asArray(container?.container?.rootfiles?.rootfile)[0]
  const fullPath = attr(rootfile, "full-path")
  if (!fullPath) throw new BookError("UNSUPPORTED", "The EPUB container declares no root file.")
  return normalizePath(fullPath)
}

function readMetadata(pkg: unknown) {
  const metadata = prop(pkg, "metadata")
  return {
    title: text(asArray(prop(metadata, "title"))[0]) ?? "Untitled book",
    author: text(asArray(prop(metadata, "creator"))[0]),
    language: text(asArray(prop(metadata, "language"))[0]),
  }
}

type ManifestItem = { id: string; path: string; mediaType: string; properties: string }

function readManifest(pkg: unknown, opfDir: string) {
  const items = new Map<string, ManifestItem>()
  for (const raw of asArray(prop(prop(pkg, "manifest"), "item"))) {
    const id = attr(raw, "id")
    const href = attr(raw, "href")
    if (!id || !href) continue
    items.set(id, {
      id,
      path: resolveFrom(opfDir, href),
      mediaType: attr(raw, "media-type") ?? "",
      properties: attr(raw, "properties") ?? "",
    })
  }
  return items
}

function readSpine(pkg: unknown, manifest: Map<string, ManifestItem>): EpubSpineEntry[] {
  const entries: EpubSpineEntry[] = []
  for (const raw of asArray(prop(prop(pkg, "spine"), "itemref"))) {
    const idref = attr(raw, "idref")
    if (!idref) continue
    const item = manifest.get(idref)
    if (!item || !/x?html/i.test(item.mediaType)) continue
    entries.push({ id: idref, path: item.path })
  }
  return entries
}

// EPUB 3 ships an XHTML nav document, EPUB 2 an NCX. Prefer the nav document and
// fall back to the NCX; an EPUB with neither simply has no chapters.
function readToc(input: {
  pkg: unknown
  manifest: Map<string, ManifestItem>
  readText: (path: string) => string
  hasEntry: (path: string) => boolean
}): EpubTocEntry[] {
  const items = [...input.manifest.values()]
  const nav = items.find((item) => item.properties.split(/\s+/).includes("nav"))
  if (nav && input.hasEntry(nav.path)) {
    const entries = readNavToc(input.readText(nav.path), posix.dirname(nav.path))
    if (entries.length > 0) return entries
  }

  const tocId = attr(prop(input.pkg, "spine"), "toc")
  const ncx =
    (tocId ? input.manifest.get(tocId) : undefined) ??
    items.find((item) => item.mediaType === "application/x-dtbncx+xml")
  if (ncx && input.hasEntry(ncx.path)) {
    return readNcxToc(input.readText(ncx.path), posix.dirname(ncx.path))
  }

  return []
}

function readNavToc(xml: string, baseDir: string): EpubTocEntry[] {
  const doc = parser.parse(xml)
  const navs = collect(doc, "nav")
  const toc = navs.find((nav) => attr(nav, "type") === "toc") ?? navs[0]
  if (!toc) return []

  const entries: EpubTocEntry[] = []
  for (const anchor of collect(toc, "a")) {
    const href = attr(anchor, "href")
    const title = text(anchor)
    if (!href || !title) continue
    entries.push({ title, path: resolveFrom(baseDir, href) })
  }
  return entries
}

function readNcxToc(xml: string, baseDir: string): EpubTocEntry[] {
  const doc = parser.parse(xml)
  const entries: EpubTocEntry[] = []
  for (const point of collect(prop(doc, "ncx"), "navPoint")) {
    const href = attr(prop(point, "content"), "src")
    const title = text(prop(prop(point, "navLabel"), "text"))
    if (!href || !title) continue
    entries.push({ title, path: resolveFrom(baseDir, href) })
  }
  return entries
}

// --- tiny helpers over fast-xml-parser's plain-object output ---

function asArray(value: unknown): unknown[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function prop(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined
  return (value as Record<string, unknown>)[key]
}

function attr(value: unknown, name: string): string | null {
  const raw = prop(value, `@_${name}`)
  return typeof raw === "string" && raw.length > 0 ? raw : null
}

// Element text, whether fast-xml-parser produced a bare string or an object with
// a `#text` child (which happens as soon as the element carries an attribute).
function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  const inner = prop(value, "#text")
  return typeof inner === "string" ? inner.trim() || null : null
}

// Depth-first collection of every descendant stored under `key`, in document order.
function collect(node: unknown, key: string): unknown[] {
  const found: unknown[] = []
  const visit = (value: unknown) => {
    for (const item of asArray(value)) {
      if (!item || typeof item !== "object") continue
      for (const [childKey, childValue] of Object.entries(item as Record<string, unknown>)) {
        if (childKey.startsWith("@_") || childKey === "#text") continue
        for (const child of asArray(childValue)) {
          if (childKey === key) found.push(child)
          visit(child)
        }
      }
    }
  }
  visit(node)
  return found
}

function resolveFrom(baseDir: string, href: string) {
  const [target] = decodeHref(href).split("#")
  return normalizePath(baseDir === "." ? (target ?? "") : posix.join(baseDir, target ?? ""))
}

function decodeHref(href: string) {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

function normalizePath(path: string) {
  return posix.normalize(path).replace(/^\.?\//, "")
}
