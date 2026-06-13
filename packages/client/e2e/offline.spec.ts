import { test, expect } from "@playwright/test"

// Offline review: mark a deck for offline use, go offline, review a card from the local snapshot,
// reconnect, and confirm the queued review syncs (the card lands on cooldown server-side).
// The service worker is inactive under `vite dev`, so this exercises the in-page path (no cold
// reload): connectivity toggles via context.setOffline while the SPA stays loaded.
test("offline review queues locally and syncs on reconnect", async ({ page, context }) => {
  const email = `e2e-offline-${Date.now()}@test.local`
  const password = "passw0rd!"

  await page.goto("/signup")
  await page.getByLabel("Name").fill("E2E Offline")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign up" }).click()
  await page.getByRole("link", { name: "Back to log in" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Log in" }).click()
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible()

  // Deck without a study language → no speech recognition UI to deal with.
  await page.getByRole("button", { name: "New deck" }).click()
  await page.getByPlaceholder("e.g. German A1").fill("Offline Deck")
  await page.getByRole("button", { name: "Create" }).click()

  await page.getByRole("button", { name: /Offline Deck/ }).click()
  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Add card" }).click()
  await page.getByRole("textbox", { name: "Subject" }).fill("Haus")
  await page.getByRole("textbox", { name: "Front" }).fill("Haus")
  await page.getByRole("textbox", { name: "Back" }).fill("house")
  await page.getByRole("button", { name: "Create" }).click()
  await expect(page.getByTestId("deck-subject-stats")).toContainText("1 subject, 1 card")

  // Mark the deck available offline (pulls the snapshot into IndexedDB).
  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Options" }).click()
  const snapshotPulled = page.waitForResponse((r) => r.url().includes("offline.snapshot"))
  await page.getByRole("button", { name: "Make available offline" }).click()
  await snapshotPulled
  await page.keyboard.press("Escape") // close the menu popover

  // Go offline and review from the snapshot.
  await context.setOffline(true)
  await expect(page.getByTestId("offline-indicator")).toBeVisible()
  await page
    .getByRole("link", { name: /Review/ })
    .first()
    .click()
  await expect(page.getByText("Haus")).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByText("house")).toBeVisible()
  await page.getByRole("button", { name: /^3/ }).click()
  await expect(page.getByRole("heading", { name: "All caught up" })).toBeVisible()

  // Reconnect → the queued review flushes to the server.
  const reviewsSynced = page.waitForResponse((r) => r.url().includes("syncReviews"))
  await context.setOffline(false)
  await reviewsSynced
  await expect(page.getByTestId("offline-indicator")).toBeHidden()

  // Server now has the card on cooldown: the deck shows no cards due (was 1 due before).
  await page.goto("/")
  await page.getByRole("button", { name: /Offline Deck/ }).click()
  await expect(page.getByRole("link", { name: /Free review \(no cards due\)/ })).toBeVisible()
})

test("offline sequential deck walks cards in order and syncs", async ({ page, context }) => {
  const email = `e2e-offline-seq-${Date.now()}@test.local`
  const password = "passw0rd!"

  await page.goto("/signup")
  await page.getByLabel("Name").fill("E2E Offline Seq")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign up" }).click()
  await page.getByRole("link", { name: "Back to log in" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Log in" }).click()
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible()

  await page.getByRole("button", { name: "New deck" }).click()
  await page.getByPlaceholder("e.g. German A1").fill("Seq Deck")
  await page.getByRole("button", { name: "Create" }).click()
  await page.getByRole("button", { name: /Seq Deck/ }).click()

  // Enable sequential mode via the Options submenu.
  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Options" }).click()
  const settingsSaved = page.waitForResponse((r) => r.url().includes("decks.update"))
  await page.getByText("Sequential deck").click()
  await settingsSaved
  await page.keyboard.press("Escape")

  // Two cards in one subject → first advances, second grades.
  for (const [front, back] of [
    ["AlphaFront", "AlphaBack"],
    ["BravoFront", "BravoBack"],
  ]) {
    await page.getByRole("button", { name: "Menu" }).click()
    await page.getByRole("button", { name: "Add card" }).click()
    await page.getByRole("textbox", { name: "Subject" }).fill("Subj")
    await page.getByRole("textbox", { name: "Front" }).fill(front)
    await page.getByRole("textbox", { name: "Back" }).fill(back)
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByTestId("deck-subject-stats")).toBeVisible()
  }

  // Mark offline.
  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Options" }).click()
  const snapshotPulled = page.waitForResponse((r) => r.url().includes("offline.snapshot"))
  await page.getByRole("button", { name: "Make available offline" }).click()
  await snapshotPulled
  await page.keyboard.press("Escape")

  // Go offline and walk the deck in order.
  await context.setOffline(true)
  await expect(page.getByTestId("offline-indicator")).toBeVisible()
  await page.getByRole("link", { name: "Review", exact: true }).click()

  await expect(page.getByText("AlphaFront")).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByText("AlphaBack")).toBeVisible()
  await page.getByRole("button", { name: "Next" }).click()

  await expect(page.getByText("BravoFront")).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByText("BravoBack")).toBeVisible()
  await page.getByRole("button", { name: /^3/ }).click()

  await expect(page.getByRole("heading", { name: "Reached the end" })).toBeVisible()

  // Reconnect → the queued advance + grade flush to the server.
  const reviewsSynced = page.waitForResponse((r) => r.url().includes("syncReviews"))
  await context.setOffline(false)
  await reviewsSynced
  await expect(page.getByTestId("offline-indicator")).toBeHidden()
})
