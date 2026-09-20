import TurndownService from "turndown"

const REMOVED_TAGS = new Set([
  "script",
  "style",
  "head",
  "title",
  "svg",
  "img",
  "picture",
  "figure",
  "video",
  "audio",
  "table",
  "nav",
  "form",
])

// "Simplified markdown": the reader only renders prose, so everything that would
// need assets or wide layout (images, tables, media) is dropped rather than
// turned into markdown the MarkdownView can't show on a phone.
function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  })

  // addRule, not remove(): turndown checks its own rules first, so `remove` never
  // fires for a tag that has a built-in rule (img would come back as markdown).
  turndown.addRule("strip", {
    filter: (node) => REMOVED_TAGS.has(node.nodeName.toLowerCase()),
    replacement: () => "",
  })

  // Footnote/cross-reference links have no target inside the reader, so keep the
  // link text and drop the anchor.
  turndown.addRule("unlink", {
    filter: "a",
    replacement: (content) => content,
  })

  return turndown
}

const turndown = createTurndown()

export function htmlToMarkdown(html: string) {
  return normalizeMarkdown(turndown.turndown(stripDoctype(html)))
}

function stripDoctype(html: string) {
  return html.replace(/<\?xml[^>]*\?>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "")
}

function normalizeMarkdown(markdown: string) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
