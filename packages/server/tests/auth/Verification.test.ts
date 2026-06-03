import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("../../src/infra/mailer.js", () => ({
  sendMail: vi.fn(),
  sendVerificationEmail: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
}))

import { auth } from "../../src/infra/auth.js"
import { prisma } from "../../src/infra/db.js"
import { sendVerificationEmail } from "../../src/infra/mailer.js"

const mockedSendVerification = vi.mocked(sendVerificationEmail)

beforeAll(async () => {
  await prisma.user.deleteMany()
})

afterEach(async () => {
  mockedSendVerification.mockClear()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.verification.deleteMany()
  await prisma.user.deleteMany()
})

describe("email verification", () => {
  test("signup creates an unverified user and sends verification email", async () => {
    await auth.api.signUpEmail({
      body: { name: "Alice", email: "alice@test.local", password: "passw0rd" },
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "alice@test.local" } })
    expect(user.emailVerified).toBe(false)
    expect(mockedSendVerification).toHaveBeenCalledTimes(1)
    expect(mockedSendVerification.mock.calls[0]?.[0]).toBe("alice@test.local")
  })

  test("sign-in is blocked while emailVerified is false", async () => {
    await auth.api.signUpEmail({
      body: { name: "Bob", email: "bob@test.local", password: "passw0rd" },
    })

    await expect(
      auth.api.signInEmail({
        body: { email: "bob@test.local", password: "passw0rd" },
      })
    ).rejects.toMatchObject({ status: "FORBIDDEN" })
  })

  test("sign-in succeeds once emailVerified is true", async () => {
    await auth.api.signUpEmail({
      body: { name: "Carol", email: "carol@test.local", password: "passw0rd" },
    })
    await prisma.user.update({
      where: { email: "carol@test.local" },
      data: { emailVerified: true },
    })

    const res = await auth.api.signInEmail({
      body: { email: "carol@test.local", password: "passw0rd" },
    })
    expect(res.user.email).toBe("carol@test.local")
  })
})
