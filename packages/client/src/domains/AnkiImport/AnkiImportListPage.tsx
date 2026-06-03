import { useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import type { AnkiImportListItemView } from "@cards/shared"
import { trpc } from "../../infra/trpc"
import { PageHeader } from "../../components/AppShell"
import { Button, buttonVariants } from "../../ui/Button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/Dialog"
import { cn } from "../../Lib/Utils"

const STATUS_LABEL: Record<AnkiImportListItemView["status"], string> = {
  UPLOADED: "Uploaded",
  ANALYZING: "Analyzing…",
  AWAITING_CONFIGURATION: "Needs configuration",
  VALIDATING: "Validating…",
  IMPORTING: "Importing…",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
}

const STATUS_COLOR: Record<AnkiImportListItemView["status"], string> = {
  UPLOADED: "text-muted-foreground",
  ANALYZING: "text-muted-foreground",
  AWAITING_CONFIGURATION: "text-yellow-500",
  VALIDATING: "text-muted-foreground",
  IMPORTING: "text-muted-foreground",
  SUCCEEDED: "text-primary",
  FAILED: "text-destructive",
}

export function AnkiImportListPage() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const imports = trpc.ankiImport.list.useQuery()
  const deleteImport = trpc.ankiImport.delete.useMutation({
    onSuccess: () => {
      utils.ankiImport.list.invalidate()
      setDeleteId(null)
    },
  })
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deleteTarget = imports.data?.find((item) => item.id === deleteId)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Anki imports"
        onBack={() => navigate({ to: "/" })}
        actions={
          <Link
            to="/imports/anki/new"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 px-3")}
          >
            <Plus className="h-4 w-4" />
            New import
          </Link>
        }
      />

      {imports.data && imports.data.length > 0 ? (
        <ul className="space-y-2">
          {imports.data.map((item) => (
            <li key={item.id}>
              <Link
                to="/imports/anki/$processId"
                params={{ processId: item.id }}
                className="flex min-h-[72px] flex-col justify-center gap-1 rounded-md border bg-card px-4 py-3 text-sm transition duration-150 hover:bg-accent active:bg-[hsl(var(--accent-strong))] active:opacity-80"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {item.deckName ?? item.filename.replace(/\.apkg$/i, "")}
                  </span>
                  <span className={cn("shrink-0 text-xs font-medium", STATUS_COLOR[item.status])}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {item.status === "SUCCEEDED"
                    ? `${item.importedCardCount} cards imported`
                    : item.filename}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : imports.isLoading ? null : (
        <p className="text-sm text-muted-foreground">No imports yet.</p>
      )}

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete import?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the import record and its uploaded file.{" "}
            {deleteTarget?.deckName && (
              <span>The deck &ldquo;{deleteTarget.deckName}&rdquo; will not be affected.</span>
            )}
          </p>
          {deleteImport.error && (
            <p className="text-sm text-destructive">{deleteImport.error.message}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteId(null)}
              disabled={deleteImport.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => deleteId && deleteImport.mutate({ id: deleteId })}
              disabled={deleteImport.isPending}
            >
              {deleteImport.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
