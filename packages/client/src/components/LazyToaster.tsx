import { useEffect, useState, type ComponentType } from "react"

type ToasterProps = {
  richColors?: boolean
  position?:
    | "top-left"
    | "top-center"
    | "top-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right"
}

export function LazyToaster(props: ToasterProps) {
  const [Toaster, setToaster] = useState<ComponentType<ToasterProps> | null>(null)

  useEffect(() => {
    let cancelled = false
    const schedule =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? (cb: () => void) =>
            (
              window as unknown as { requestIdleCallback: (cb: () => void) => void }
            ).requestIdleCallback(cb)
        : (cb: () => void) => setTimeout(cb, 200)
    schedule(() => {
      if (cancelled) return
      void import("sonner").then((m) => {
        if (!cancelled) setToaster(() => m.Toaster as ComponentType<ToasterProps>)
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!Toaster) return null
  return <Toaster {...props} />
}
