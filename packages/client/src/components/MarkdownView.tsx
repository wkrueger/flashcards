import { useMemo } from "react"
import { Lexer, marked, type Token, type Tokens, type TokensList } from "marked"

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    paragraph({ tokens }) {
      const text = this.parser.parseInline(tokens)
      return `<p class="text-lg leading-relaxed">${text}</p>`
    },
    strong({ tokens }) {
      const text = this.parser.parseInline(tokens)
      return `<strong class="font-semibold text-primary underline underline-offset-4">${text}</strong>`
    },
  },
})

export function MarkdownView({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source])
  return (
    <div
      className="prose prose-lg max-w-none dark:prose-invert [&>*:first-child]:mt-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default MarkdownView

function renderMarkdown(source: string) {
  const tokens = marked.lexer(source)
  return marked.parser(splitParagraphTokens(tokens))
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
