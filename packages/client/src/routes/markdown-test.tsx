import { createFileRoute } from "@tanstack/react-router"
import { MarkdownView } from "../components/MarkdownView"

export const Route = createFileRoute("/markdown-test")({
  component: MarkdownTestPage,
})

const TEST_MD = `
_Möchten Sie eine Banane?_ **bold prose**

> This is a blockquote citation

| Kasus | maskulin | neutral | feminin | Plural |
| --- | --- | --- | --- | --- |
| Nominativ | **ein** Mann | **ein** Haus | **eine** Frau | **-** Autos |
| Akkusativ | **einen** Kaffee | **ein** Brötchen | **eine** Banane | **-** Kartoffeln |
| Dativ | **einem** Freund | **einem** Auto | **einer** Freundin | **-** Freunden |
`.trim()

function MarkdownTestPage() {
  return (
    <div className="min-h-[8rem] p-4" data-testid="markdown-test">
      <MarkdownView source={TEST_MD} />
    </div>
  )
}
