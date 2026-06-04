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
      blockquoteFontStyle: bq ? window.getComputedStyle(bq).fontStyle : null,
      blockquoteBg: bq ? window.getComputedStyle(bq).backgroundColor : null,
      pFontStyle: (() => {
        const p = q("p")
        return p ? window.getComputedStyle(p).fontStyle : null
      })(),
    }
  })

  console.log("Computed font sizes px:", sizes)

  // prose elements all same size
  for (const key of ["em", "p", "strong", "blockquote"] as const) {
    expect(sizes[key], `<${key}> in prose should be 20px`).toBe(20)
  }

  // table cells smaller, all consistent
  for (const key of ["td", "th", "tdStrong"] as const) {
    expect(sizes[key], `${key} in table should be smaller than prose`).toBeLessThan(sizes.p!)
    expect(sizes[key], `${key} in table should match td`).toBe(sizes.td)
  }

  // blockquote visually distinct from paragraph: italic + tinted background
  expect(sizes.blockquoteFontStyle, "blockquote should be italic").toBe("italic")
  expect(sizes.pFontStyle, "paragraph should not be italic").toBe("normal")
  expect(sizes.blockquoteBg, "blockquote should have a tinted background").not.toBe(
    "rgba(0, 0, 0, 0)"
  )
})
