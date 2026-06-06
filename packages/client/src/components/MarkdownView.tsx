import { useMemo } from "react"
import { Lexer, marked, type Token, type Tokens, type TokensList } from "marked"

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens)
      return `<h${depth} class="italic text-muted-foreground">${text}</h${depth}>`
    },
    paragraph({ tokens }) {
      const text = this.parser.parseInline(tokens)
      return `<p class="leading-relaxed">${text}</p>`
    },
    strong({ tokens }) {
      const text = this.parser.parseInline(tokens)
      return `<strong class="font-semibold text-primary underline underline-offset-4">${text}</strong>`
    },
    blockquote({ tokens }) {
      const content = this.parser.parse(tokens)
      return `<blockquote class="border-l-4 border-[hsl(28_92%_56%)] bg-[hsl(28_92%_56%/0.12)] pl-4 pr-2 py-1 rounded-r-md italic font-light">${content}</blockquote>`
    },
    table(token) {
      let header = "<thead><tr>"
      token.header.forEach((cell, i) => {
        const content = this.parser.parseInline(cell.tokens)
        const borderL = i === 0 ? "border-l border-border " : ""
        header += `<th class="${borderL}border-t border-r border-b border-border bg-muted px-2 py-1 text-left align-top">${content}</th>`
      })
      header += "</tr></thead><tbody>"
      for (const row of token.rows) {
        header += "<tr>"
        row.forEach((cell, i) => {
          const content = this.parser.parseInline(cell.tokens)
          const borderL = i === 0 ? "border-l border-border " : ""
          header += `<td class="${borderL}border-r border-b border-border px-2 py-1 text-left align-top">${content}</td>`
        })
        header += "</tr>"
      }
      return `<div class="rounded-md overflow-x-auto"><table class="w-max min-w-full border-separate border-spacing-0 text-xs">${header}</tbody></table></div>`
    },
  },
})

export function MarkdownView({ source, prefix }: { source: string; prefix?: string }) {
  const html = useMemo(() => renderMarkdown(source, prefix), [source, prefix])
  return (
    <div
      className="max-w-none text-[20px] [&>*+*]:mt-3 [&_li+li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default MarkdownView

function renderMarkdown(source: string, prefix?: string) {
  const noOrderedLists = source.replace(/^(\s*)(\d+)\. /gm, "$1$2\\. ")
  const tokens = marked.lexer(noOrderedLists)
  if (prefix) {
    prependInlinePrefix(tokens, prefix)
  }
  return marked.parser(splitParagraphTokens(tokens))
}

// Inject the emoji prefix into the first block's inline tokens so it renders
// inline with the leading content without disturbing block-level syntax (a
// `## heading` stays a heading instead of becoming literal text).
function prependInlinePrefix(tokens: TokensList | Token[], prefix: string) {
  const first = tokens[0] as (Token & { tokens?: Token[]; text?: string }) | undefined
  if (first && Array.isArray(first.tokens)) {
    first.tokens.unshift({ type: "text", raw: prefix, text: prefix } as Tokens.Text)
    first.raw = `${prefix}${first.raw}`
    if (typeof first.text === "string") {
      first.text = `${prefix}${first.text}`
    }
    return
  }
  tokens.unshift({
    type: "paragraph",
    raw: prefix,
    text: prefix,
    tokens: Lexer.lexInline(prefix),
  } as Tokens.Paragraph)
}

function splitParagraphTokens(tokens: TokensList | Token[]): TokensList | Token[] {
  const nextTokens = tokens.flatMap((token) => splitParagraphToken(token))

  if ("links" in tokens) {
    return Object.assign(nextTokens, { links: tokens.links })
  }

  return nextTokens
}

function splitParagraphToken(token: Token): Token[] {
  const nextToken = cloneNestedTokens(token)

  if (nextToken.type !== "paragraph") {
    return [nextToken]
  }

  const paragraphToken = nextToken as Tokens.Paragraph
  const parts: string[] = paragraphToken.text.split(/\r?\n/)
  if (parts.length === 1) {
    return [paragraphToken]
  }

  return parts.map(
    (part: string): Tokens.Paragraph => ({
      ...paragraphToken,
      raw: part,
      text: part,
      tokens: Lexer.lexInline(part),
    })
  )
}

function cloneNestedTokens(token: Token): Token {
  if ("tokens" in token && Array.isArray(token.tokens)) {
    return {
      ...token,
      tokens: splitParagraphTokens(token.tokens),
    }
  }

  if (token.type === "list") {
    return {
      ...token,
      items: token.items.map((item: Tokens.ListItem) => cloneNestedTokens(item) as Tokens.ListItem),
    }
  }

  return token
}
