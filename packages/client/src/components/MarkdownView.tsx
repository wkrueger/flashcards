import ReactMarkdown from "react-markdown"

export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="prose prose-lg max-w-none dark:prose-invert [&>*:first-child]:mt-0">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="text-lg leading-relaxed">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-primary underline underline-offset-4">
              {children}
            </strong>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
