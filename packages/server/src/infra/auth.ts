import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { prisma } from "./db.js"

const secret = process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me-please-32-chars-min"

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  trustedOrigins: [process.env.CLIENT_ORIGIN ?? "http://localhost:5173"],
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 6,
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: false,
    },
  },
})

export type Auth = typeof auth
