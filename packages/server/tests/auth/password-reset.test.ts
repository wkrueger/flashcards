import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("../../src/infra/mailer.js", () => ({
  sendMail: vi.fn(),
  sendVerificationEmail: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
}))

import { auth } from "../../src/infra/auth.js"
import { prisma } from "../../src/infra/db.js"
import { sendPasswordResetEmail } from "../../src/infra/mailer.js"

const mockedSendReset = vi.mocked(sendPasswordResetEmail)

async function createVerifiedUser(email: string, password: string) {
  await auth.api.signUpEmail({ body: { name: "Reset User", email, password } })
  await prisma.user.update({ where: { email }, data: { emailVerified: true } })
}

beforeAll(async () => {
  await prisma.user.deleteMany()
})

afterEach(async () => {
  mockedSendReset.mockClear()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.verification.deleteMany()
  await prisma.user.deleteMany()
})

describe("password reset", () => {
  test("request → reset → login with new password; old password rejected", async () => {
    const email = "reset@test.local"
    await createVerifiedUser(email, "oldpassw0rd")

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost/reset-password" },
    })

    expect(mockedSendReset).toHaveBeenCalledTimes(1)
    const url = mockedSendReset.mock.calls[0]?.[1]
    if (!url) throw new Error("no reset url captured")
    const token = new URL(url).pathname.split("/").pop()
    if (!token) throw new Error("no token in reset url")

    await auth.api.resetPassword({
      body: { newPassword: "newpassw0rd", token },
    })

    const ok = await auth.api.signInEmail({
      body: { email, password: "newpassw0rd" },
    })
    expect(ok.user.email).toBe(email)

    await expect(
      auth.api.signInEmail({ body: { email, password: "oldpassw0rd" } })
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" })
  })
})
