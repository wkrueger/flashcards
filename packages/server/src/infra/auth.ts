import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { prisma } from "./db.js"

const secret = process.env.BETTER_AUTH_SECRET
if (!secret) throw new Error("BETTER_AUTH_SECRET env var is required")

const isProd = process.env.NODE_ENV === "production"

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
      secure: isProd,
    },
  },
})

export type Auth = typeof auth
