import { test, expect } from "@playwright/test"

test("markdown elements have consistent font size", async ({ page }) => {
  await page.goto("/markdown-test")
  await expect(page.getByTestId("markdown-test")).toBeVisible()

  const sizes = await page.evaluate(() => {
    const q = (sel: string) => document.querySelector(sel)
    const size = (el: Element | null) =>
      el ? parseFloat(window.getComputedStyle(el).fontSize) : null

    const bq = q("blockquote")
    return {
      em: size(q("p em")),
      p: size(q("p")),
      strong: size(q("p strong")),
      td: size(q("td")),
      th: size(q("th")),
      tdStrong: size(q("td strong")),
      blockquote: size(bq),
      blockquoteColor: bq ? window.getComputedStyle(bq).color : null,
      pColor: (() => { const p = q("p"); return p ? window.getComputedStyle(p).color : null })(),
    }
  })

  console.log("Computed font sizes px:", sizes)

  // prose elements all same size
  for (const key of ["em", "p", "strong", "blockquote"] as const) {
    expect(sizes[key], `<${key}> in prose should be 18px`).toBe(18)
  }

  // table cells smaller, all consistent
  for (const key of ["td", "th", "tdStrong"] as const) {
    expect(sizes[key], `${key} in table should be smaller than 18px`).toBeLessThan(18)
    expect(sizes[key], `${key} in table should match td`).toBe(sizes.td)
  }

  // blockquote visually distinct from paragraph
  expect(sizes.blockquoteColor, "blockquote color should differ from paragraph").not.toBe(sizes.pColor)
})
