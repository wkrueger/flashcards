import Fastify from "fastify"
import cors from "@fastify/cors"
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify"
import { auth } from "./infra/auth.js"
import { createContext } from "./infra/trpc.js"
import { appRouter } from "./domains/_app.router.js"

const port = Number(process.env.SERVER_PORT ?? 3001)
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173"

export async function buildServer() {
  const app = Fastify({ logger: { level: "info" } })

  await app.register(cors, {
    origin: clientOrigin,
    credentials: true,
  })

  // Mount better-auth as a catch-all under /api/auth/*
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(req, reply) {
      const url = new URL(req.url, `http://${req.headers.host}`)
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
