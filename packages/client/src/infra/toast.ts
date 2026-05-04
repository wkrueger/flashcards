let sonnerPromise: Promise<typeof import("sonner")> | null = null

function loadSonner() {
  if (!sonnerPromise) sonnerPromise = import("sonner")
  return sonnerPromise
}

export const toast = {
  error: (msg: string) => {
    void loadSonner().then((m) => m.toast.error(msg))
  },
  success: (msg: string) => {
    void loadSonner().then((m) => m.toast.success(msg))
  },
  message: (msg: string) => {
    void loadSonner().then((m) => m.toast(msg))
  },
}
