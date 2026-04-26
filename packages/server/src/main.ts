import Fastify from "fastify"
import cors from "@fastify/cors"
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify"
import { auth } from "./infra/auth.js"
import { createContext } from "./infra/trpc.js"
import { appRouter } from "./domains/_app.router.js"

const port = Number(process.env.SERVER_PORT ?? 3001)
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173"

function isUserCreationDisabled() {
  return ["1", "true", "yes"].includes(
    (process.env.DISABLE_USER_CREATION ?? "").trim().toLowerCase()
  )
}

function isSignupRequest(pathname: string) {
  return pathname.split("/").includes("sign-up")
}

const isProd = process.env.NODE_ENV === "production"

export async function buildServer() {
  const app = Fastify({
    logger: isProd
      ? { level: "info" }
      : {
          level: "info",
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss",
              ignore: "pid,hostname",
              messageFormat: "{req.method} {req.url} {res.statusCode} — {msg}",
              singleLine: true,
            },
          },
        },
  })

  await app.register(cors, {
    origin: clientOrigin,
    credentials: true,
  })

  // Mount better-auth as a catch-all under /api/auth/*
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    bodyLimit: 16 * 1024, // 16 KB — more than enough for auth payloads
    async handler(req, reply) {
      const url = new URL(req.url, `http://${req.headers.host}`)
      if (isUserCreationDisabled() && isSignupRequest(url.pathname)) {
        req.log.warn({ path: url.pathname }, "User creation is disabled")
        reply.status(403).send({ message: "User creation is disabled." })
        return
      }

      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) headers.set(k, v.join(", "))
        else if (v != null) headers.set(k, String(v))
      }
      const request = new Request(
        `${process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`}${url.pathname}${url.search}`,
        {
          method: req.method,
          headers,
          body:
            req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body),
        }
      )
      const response = await auth.handler(request)
      reply.status(response.status)
      response.headers.forEach((value, key) => {
        reply.header(key, value)
      })
      const text = await response.text()
      reply.send(text)
    },
  })

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
    },
  })

  app.get("/health", async () => ({ ok: true }))

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  app
    .listen({ port, host: "0.0.0.0" })
    .then(() => {
      console.log(`Server listening on http://localhost:${port}`)
    })
    .catch((err) => {
      app.log.error(err)
      process.exit(1)
    })
}
