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
  trustedOrigins: [
    process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    ...(isProd
      ? []
      : [
          "http://10.*.*.*:5173",
          "http://172.16.*.*:5173",
          "http://172.17.*.*:5173",
          "http://172.18.*.*:5173",
          "http://172.19.*.*:5173",
          "http://172.20.*.*:5173",
          "http://172.21.*.*:5173",
          "http://172.22.*.*:5173",
          "http://172.23.*.*:5173",
          "http://172.24.*.*:5173",
          "http://172.25.*.*:5173",
          "http://172.26.*.*:5173",
          "http://172.27.*.*:5173",
          "http://172.28.*.*:5173",
          "http://172.29.*.*:5173",
          "http://172.30.*.*:5173",
          "http://172.31.*.*:5173",
          "http://192.168.*.*:5173",
        ]),
  ],
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
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/get-session": { window: 60, max: 240 },
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

export async function getSessionFromRawHeaders(
  rawHeaders: Record<string, string | string[] | undefined>
) {
  const headers = new Headers()

  for (const [key, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "))
    } else if (value != null) {
      headers.set(key, String(value))
    }
  }

  return auth.api.getSession({ headers })
}
