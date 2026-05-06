import { test, expect } from "@playwright/test"

test("signup → deck → card → review → free review → edit → logout", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.local`
  const password = "passw0rd!"

  await page.addInitScript(() => {
    type SpeechRecognitionMockWindow = Window &
      typeof globalThis & {
        SpeechRecognition?: unknown
        webkitSpeechRecognition?: unknown
        __lastSpeechRecognition?: {
          emitResult: (transcript: string, isFinal?: boolean) => void
        }
      }

    class MockSpeechRecognition {
      static async available({ langs }: { langs: string[] }) {
        return langs.includes("de-DE") ? "available" : "unavailable"
      }

      lang = ""
      continuous = false
      interimResults = false
      maxAlternatives = 1
      onstart: (() => void) | null = null
      onend: (() => void) | null = null
      onresult:
        | ((event: {
            resultIndex: number
            results: {
              length: number
              [index: number]: { isFinal: boolean; 0: { transcript: string } } | undefined
            }
          }) => void)
        | null = null
      onerror: ((event: { error: string }) => void) | null = null

      start() {
        ;(window as SpeechRecognitionMockWindow).__lastSpeechRecognition = this
        window.setTimeout(() => this.onstart?.(), 0)
      }

      stop() {
        window.setTimeout(() => this.onend?.(), 0)
      }

      abort() {
        window.setTimeout(() => this.onend?.(), 0)
      }

      emitResult(transcript: string, isFinal = false) {
        this.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: { isFinal, 0: { transcript } },
          },
        })
      }
    }

    const speechWindow = window as SpeechRecognitionMockWindow
    speechWindow.SpeechRecognition = MockSpeechRecognition
    speechWindow.webkitSpeechRecognition = MockSpeechRecognition
  })

  await page.goto("/signup")
  await page.getByLabel("Name").fill("E2E User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign up" }).click()

  // With email verification on, signup lands on the "Check your email" screen.
  // The e2e env auto-verifies (AUTH_E2E_AUTOVERIFY=1), so we can log in directly.
  await page.getByRole("link", { name: "Back to log in" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Log in" }).click()

  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible()

  await page.getByRole("button", { name: "New deck" }).click()
  await page.getByPlaceholder("e.g. German A1").fill("German A1")
  const studyLanguageSelect = page.locator("select").nth(1)
  const deutschLanguageId = await studyLanguageSelect
    .locator("option", { hasText: "Deutsch" })
    .getAttribute("value")
  if (!deutschLanguageId) throw new Error("Deutsch language option was not seeded")
  await studyLanguageSelect.selectOption(deutschLanguageId)
  await page.getByRole("button", { name: "Create" }).click()
  await page.getByRole("link", { name: /German A1/ }).click()
  await expect(page.getByRole("checkbox", { name: /Speech recognition/ })).toBeChecked()

  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Add card" }).click()
  await page.getByPlaceholder("Subject (e.g. Haus)").fill("Haus")
  await page.getByLabel("Front (markdown)").fill("**Haus** ist groß.")
  await page.getByLabel("Back (markdown)").fill("The **house** is big.")
  await page.getByRole("button", { name: "Create" }).click()

  await page.getByRole("link", { name: /Review 1 due/ }).click()
  // Card front must render (catches MarkdownView crashes before reveal)
  await expect(page.getByText(/ist groß/)).toBeVisible()
  await expect(page.getByTestId("speech-recognition-card")).toBeVisible()
  await page.getByRole("button", { name: "Start speech recognition" }).click()
  await expect(page.getByRole("button", { name: "Stop speech recognition" })).toBeVisible()
  await page.evaluate(() => {
    ;(
      window as typeof window & {
        __lastSpeechRecognition?: {
          emitResult: (transcript: string, isFinal?: boolean) => void
        }
      }
    ).__lastSpeechRecognition?.emitResult("Das Haus ist groß", false)
  })
  await expect(page.getByTestId("speech-recognition-transcript")).toContainText("Das Haus ist groß")
  await page.getByRole("button", { name: "Stop speech recognition" }).click()
  await expect(page.getByRole("button", { name: "Restart speech recognition" })).toBeVisible()
  await page.getByRole("button", { name: "Restart speech recognition" }).click()
  await expect(page.getByText("Das Haus ist groß")).not.toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByTestId("speech-recognition-card")).toBeVisible()
  await expect(page.getByText(/The.*house.*is big/)).toBeVisible()
  await page.getByRole("button", { name: "Restart speech recognition" }).click()
  await expect(page.getByRole("button", { name: "Stop speech recognition" })).toBeVisible()
  await page.evaluate(() => {
    ;(
      window as typeof window & {
        __lastSpeechRecognition?: {
          emitResult: (transcript: string, isFinal?: boolean) => void
        }
      }
    ).__lastSpeechRecognition?.emitResult("Noch einmal", true)
  })
  await expect(page.getByTestId("speech-recognition-transcript")).toContainText("Noch einmal")
  await page.getByRole("button", { name: "Stop speech recognition" }).click()
  await page.getByRole("button", { name: /^3/ }).click()

  // After answering, no due cards in this deck → empty state with Free review.
  await expect(page.getByRole("heading", { name: "All caught up" })).toBeVisible()
  await page.getByRole("link", { name: /Free review/ }).click()

  // Free review serves the same subject (now on cooldown).
  await expect(page.getByText("Free review")).toBeVisible()
  await expect(page.getByText(/ist groß/)).toBeVisible()
  await page.getByRole("button", { name: "Start speech recognition" }).click()
  await expect(page.getByRole("button", { name: "Stop speech recognition" })).toBeVisible()
  await page.evaluate(() => {
    ;(
      window as typeof window & {
        __lastSpeechRecognition?: {
          emitResult: (transcript: string, isFinal?: boolean) => void
        }
      }
    ).__lastSpeechRecognition?.emitResult("Das Haus ist groß", true)
  })
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByTestId("speech-recognition-card")).toBeVisible()
  await expect(page.getByTestId("speech-recognition-transcript")).toContainText("Das Haus ist groß")
  await expect(page.getByText(/The.*house.*is big/)).toBeVisible()

  // Edit from review screen.
  await page.getByRole("button", { name: "Edit card" }).click()
  await page.getByLabel("Back (markdown)").fill("The **house** is very big.")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page).toHaveURL(/\/decks\/.+$/)

  // Drop auth state and verify the app redirects anonymous users back to login.
  await page.context().clearCookies()
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole("heading", { name: "flashcards" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible()
})
