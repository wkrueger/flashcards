import { useMemo } from "react"
import { marked } from "marked"

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
  const html = useMemo(() => marked.parse(source) as string, [source])
  return (
    <div
      className="prose prose-lg max-w-none dark:prose-invert [&>*:first-child]:mt-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default MarkdownView
