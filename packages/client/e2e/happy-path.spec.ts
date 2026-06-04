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
  await page.getByRole("button", { name: /German A1/ }).click()
  await expect(page.getByRole("checkbox", { name: /Speech recognition/ })).toBeChecked()

  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Add card" }).click()
  await page.getByRole("textbox", { name: "Subject" }).fill("Haus")
  await page.getByRole("textbox", { name: "Front" }).fill("**Haus** ist groß.")
  await page.getByRole("textbox", { name: "Back" }).fill("The **house** is big.")
  await page.getByRole("button", { name: "Create" }).click()

  await expect(page.getByTestId("deck-subject-stats")).toContainText("1 subject, 1 card")
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
  await page.getByRole("button", { name: /^(Start|Restart) speech recognition$/ }).click()
  await expect(page.getByText("Das Haus ist groß")).not.toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByTestId("speech-recognition-card")).toBeVisible()
  await expect(page.getByText(/The.*house.*is big/)).toBeVisible()
  await page.getByRole("button", { name: /^(Start|Restart) speech recognition$/ }).click()
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

  // Drop auth state and verify the app redirects anonymous users back to login.
  await page.context().clearCookies()
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole("heading", { name: "flashcards" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible()
})

test("review edit exits return to the same card", async ({ page }) => {
  const email = `e2e-review-edit-${Date.now()}@test.local`
  const password = "passw0rd!"

  await page.addInitScript(() => {
    type SpeechRecognitionMockWindow = Window &
      typeof globalThis & {
        SpeechRecognition?: unknown
        webkitSpeechRecognition?: unknown
      }

    class MockSpeechRecognition {
      static async available() {
        return "available"
      }
    }

    const speechWindow = window as SpeechRecognitionMockWindow
    speechWindow.SpeechRecognition = MockSpeechRecognition
    speechWindow.webkitSpeechRecognition = MockSpeechRecognition
  })

  await page.goto("/signup")
  await page.getByLabel("Name").fill("E2E Review Edit")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign up" }).click()
  await page.getByRole("link", { name: "Back to log in" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Log in" }).click()

  await page.getByRole("button", { name: "New deck" }).click()
  await page.getByPlaceholder("e.g. German A1").fill("German Review Edit")
  const studyLanguageSelect = page.locator("select").nth(1)
  const deutschLanguageId = await studyLanguageSelect
    .locator("option", { hasText: "Deutsch" })
    .getAttribute("value")
  if (!deutschLanguageId) throw new Error("Deutsch language option was not seeded")
  await studyLanguageSelect.selectOption(deutschLanguageId)
  await page.getByRole("button", { name: "Create" }).click()
  await page.getByRole("button", { name: /German Review Edit/ }).click()

  const addCard = async (subject: string, front: string, back: string) => {
    await page.getByRole("button", { name: "Menu" }).click()
    await page.getByRole("button", { name: "Add card" }).click()
    await page.getByRole("textbox", { name: "Subject" }).fill(subject)
    await page.getByRole("textbox", { name: "Front" }).fill(front)
    await page.getByRole("textbox", { name: "Back" }).fill(back)
    await page.getByRole("button", { name: "Create" }).click()
    // Wait until the form closes (back on deck detail) before reopening the menu,
    // otherwise the next menu-open can race with navigation.
    await expect(page.getByRole("textbox", { name: "Subject" })).toBeHidden()
  }

  await addCard("Alpha", "Alpha front.", "Alpha back.")
  await addCard("Beta", "Beta front.", "Beta back.")

  await expect(page.getByTestId("deck-subject-stats")).toContainText("2 subjects, 2 cards")
  await page.getByRole("link", { name: /Review 2 due/ }).click()

  // Wait for a card to actually render before the instant visibility check below,
  // otherwise isVisible() resolves false before the front mounts and picks the
  // wrong branch.
  await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible()
  const alphaVisible = await page.getByText("Alpha front.").isVisible()
  const currentFront = alphaVisible ? "Alpha front." : "Beta front."
  const updatedBack = alphaVisible ? "Alpha back updated." : "Beta back updated."

  await page.getByRole("button", { name: "Edit card" }).click()

  const editUrl = page.url()
  const cardId = editUrl.match(/\/cards\/([^/]+)\/edit/)?.[1]
  if (!cardId) throw new Error(`Could not read card id from ${editUrl}`)

  await page.locator('button[aria-label="Back"]').click()
  await expect(page).toHaveURL(new RegExp(`/decks/[^/]+/review/cards/${cardId}\\?mode=normal$`))
  await expect(page.getByText(currentFront)).toBeVisible()

  await page.getByRole("button", { name: "Edit card" }).click()
  await page.getByRole("textbox", { name: "Back" }).fill(updatedBack)
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page).toHaveURL(new RegExp(`/decks/[^/]+/review/cards/${cardId}\\?mode=normal$`))
  await expect(page.getByText(currentFront)).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByText(updatedBack)).toBeVisible()
})

test("sequential deck walks cards in order with Next, Prev, and Restart", async ({ page }) => {
  const email = `e2e-sequential-${Date.now()}@test.local`
  const password = "passw0rd!"

  await page.goto("/signup")
  await page.getByLabel("Name").fill("E2E Sequential")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign up" }).click()
  await page.getByRole("link", { name: "Back to log in" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Log in" }).click()

  await page.getByRole("button", { name: "New deck" }).click()
  await page.getByPlaceholder("e.g. German A1").fill("German Sequential")
  await page.getByRole("button", { name: "Create" }).click()
  await page.getByRole("button", { name: /German Sequential/ }).click()

  const addCard = async (subject: string, front: string, back: string) => {
    await page.getByRole("button", { name: "Menu" }).click()
    await page.getByRole("button", { name: "Add card" }).click()
    await page.getByRole("textbox", { name: "Subject" }).fill(subject)
    await page.getByRole("textbox", { name: "Front" }).fill(front)
    await page.getByRole("textbox", { name: "Back" }).fill(back)
    await page.getByRole("button", { name: "Create" }).click()
    // Wait until the form closes (back on deck detail) before reopening the menu,
    // otherwise the next menu-open can race with navigation.
    await expect(page.getByRole("textbox", { name: "Subject" })).toBeHidden()
  }

  await addCard("Alpha", "Alpha one front", "Alpha one back")
  await addCard("Alpha", "Alpha two front", "Alpha two back")
  await addCard("Beta", "Beta front", "Beta back")

  await expect(page.getByTestId("deck-subject-stats")).toContainText("2 subjects, 3 cards")

  // Enable sequential deck via the Options submenu (the checkbox is visually
  // hidden shadcn-style, so toggle it via its label).
  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Options" }).click()
  await page.getByText("Sequential deck", { exact: true }).click()
  await expect(page.getByRole("checkbox", { name: "Sequential deck" })).toBeChecked()
  await page.keyboard.press("Escape")

  // Sequential decks show a single "Review" button.
  await page.getByRole("link", { name: "Review", exact: true }).click()

  // First card of the first subject; not the last card → "Next", no fixation buttons.
  await expect(page.getByText("Alpha one front")).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByText("Alpha one back")).toBeVisible()
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible()
  await page.getByRole("button", { name: "Next" }).click()

  // Last card of the subject → fixation buttons, no "Next".
  await expect(page.getByText("Alpha two front")).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByRole("button", { name: /^3/ })).toBeVisible()
  await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0)

  // Previous card returns to the first card of the subject.
  await page.getByRole("button", { name: "Previous card" }).click()
  await expect(page.getByText("Alpha one front")).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await page.getByRole("button", { name: "Next" }).click()

  // Complete the subject's last card → advances to the next subject.
  await expect(page.getByText("Alpha two front")).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await page.getByRole("button", { name: /^3/ }).click()
  await expect(page.getByText("Beta front")).toBeVisible()

  // Previous from the first card of a subject traverses to the previous
  // subject's last card.
  await expect(page.getByRole("button", { name: "Previous card" })).toBeEnabled()
  await page.getByRole("button", { name: "Previous card" }).click()
  await expect(page.getByText("Alpha two front")).toBeVisible()

  // Restart jumps back to the first card of the first subject after confirmation.
  await page.getByRole("button", { name: "Restart" }).click()
  await expect(page.getByRole("heading", { name: "Restart this deck?" })).toBeVisible()
  await page.getByRole("dialog").getByRole("button", { name: "Restart" }).click()
  await expect(page.getByText("Alpha one front")).toBeVisible()
})

test("deck completion percent updates after a review", async ({ page }) => {
  const email = `e2e-completion-${Date.now()}@test.local`
  const password = "passw0rd!"

  await page.addInitScript(() => {
    type SpeechRecognitionMockWindow = Window &
      typeof globalThis & {
        SpeechRecognition?: unknown
        webkitSpeechRecognition?: unknown
      }
    class MockSpeechRecognition {
      static async available() {
        return "available"
      }
    }
    const speechWindow = window as SpeechRecognitionMockWindow
    speechWindow.SpeechRecognition = MockSpeechRecognition
    speechWindow.webkitSpeechRecognition = MockSpeechRecognition
  })

  await page.goto("/signup")
  await page.getByLabel("Name").fill("E2E Completion")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign up" }).click()
  await page.getByRole("link", { name: "Back to log in" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Log in" }).click()

  await page.getByRole("button", { name: "New deck" }).click()
  await page.getByPlaceholder("e.g. German A1").fill("German Completion")
  const studyLanguageSelect = page.locator("select").nth(1)
  const deutschLanguageId = await studyLanguageSelect
    .locator("option", { hasText: "Deutsch" })
    .getAttribute("value")
  if (!deutschLanguageId) throw new Error("Deutsch language option was not seeded")
  await studyLanguageSelect.selectOption(deutschLanguageId)
  await page.getByRole("button", { name: "Create" }).click()
  await page.getByRole("button", { name: /German Completion/ }).click()
  const deckUrl = page.url()

  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Add card" }).click()
  await page.getByRole("textbox", { name: "Subject" }).fill("Haus")
  await page.getByRole("textbox", { name: "Front" }).fill("Haus front.")
  await page.getByRole("textbox", { name: "Back" }).fill("Haus back.")
  await page.getByRole("button", { name: "Create" }).click()

  // Fresh deck: the single subject is unseen -> lazy recompute yields 0%.
  await expect(page.getByTestId("deck-subject-stats")).toContainText("1 subject, 1 card, 0%")

  await page.getByRole("link", { name: /Review 1 due/ }).click()
  await expect(page.getByText("Haus front.")).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  const reviewDone = page.waitForResponse((resp) => resp.url().includes("review.complete"))
  await page.getByRole("button", { name: /^3/ }).click()
  await reviewDone
  await expect(page.getByRole("heading", { name: "All caught up" })).toBeVisible()

  // Reviewed at fixation 3 -> 0.25 over 1 subject -> 25%.
  await page.goto(deckUrl)
  await expect(page.getByTestId("deck-subject-stats")).toContainText("1 subject, 1 card, 25%")
})
