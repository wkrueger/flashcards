import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("../../src/infra/mailer.js", () => ({
  sendMail: vi.fn(),
  sendVerificationEmail: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
}))

import type { FastifyInstance } from "fastify"
import { buildServer } from "../../src/main.js"
import { prisma } from "../../src/infra/db.js"

let app: FastifyInstance

beforeAll(async () => {
  await prisma.user.deleteMany()
  app = await buildServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe("auth rate limiting", () => {
  test("repeated sign-in/email attempts return 429 after the configured max", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        payload: { email: "ratelimit@test.local", password: "wrongpassw0rd" },
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `203.0.113.${10 + i}`.replace(/\d+$/, "42"),
        },
      })
      statuses.push(res.statusCode)
    }

    expect(statuses).toContain(429)
    const firstLimited = statuses.findIndex((s) => s === 429)
    expect(firstLimited).toBeGreaterThan(0)
    expect(firstLimited).toBeLessThanOrEqual(6)
  })
})
