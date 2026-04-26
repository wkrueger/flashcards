import { betterAuth, type BetterAuthOptions } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { prisma } from "./db.js"
import { sendPasswordResetEmail, sendVerificationEmail } from "./mailer.js"

const secret = process.env.BETTER_AUTH_SECRET
if (!secret) throw new Error("BETTER_AUTH_SECRET env var is required")

const isProd = process.env.NODE_ENV === "production"

const googleId = process.env.GOOGLE_CLIENT_ID
const googleSecret = process.env.GOOGLE_CLIENT_SECRET
const socialProviders: BetterAuthOptions["socialProviders"] =
  googleId && googleSecret ? { google: { clientId: googleId, clientSecret: googleSecret } } : {}

const autoVerifyForE2E = ["1", "true", "yes"].includes(
  (process.env.AUTH_E2E_AUTOVERIFY ?? "").trim().toLowerCase()
)

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  trustedOrigins: [process.env.CLIENT_ORIGIN ?? "http://localhost:5173"],
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 6,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail(user.email, url)
    },
    resetPasswordTokenExpiresIn: 60 * 60,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, url)
    },
  },
  socialProviders,
  account: { accountLinking: { enabled: true } },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
      "/send-verification-email": { window: 60, max: 3 },
    },
  },
  databaseHooks: autoVerifyForE2E
    ? {
        user: {
          create: {
            after: async (user) => {
              await prisma.user.update({
                where: { id: user.id },
                data: { emailVerified: true },
              })
            },
          },
        },
      }
    : undefined,
  advanced: {
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: isProd,
    },
  },
})

export type Auth = typeof auth
