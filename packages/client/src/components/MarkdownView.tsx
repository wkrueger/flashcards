import { useMemo } from "react"
import { marked, Renderer } from "marked"

const renderer = new Renderer()
const baseParagraph = renderer.paragraph.bind(renderer)
const baseStrong = renderer.strong.bind(renderer)

renderer.paragraph = (token) =>
  baseParagraph(token).replace(/^<p>/, '<p class="text-lg leading-relaxed">')
renderer.strong = (token) =>
  baseStrong(token).replace(
    /^<strong>/,
    '<strong class="font-semibold text-primary underline underline-offset-4">'
  )

marked.use({ renderer, gfm: true, breaks: false, async: false })

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
