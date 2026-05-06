import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import { compression } from "vite-plugin-compression2"
import path from "node:path"

const serverOrigin = `http://localhost:${process.env.E2E_SERVER_PORT ?? "3001"}`

export default defineConfig(({ command }) => ({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    ...(command === "build"
      ? [compression({ algorithms: ["gzip"], exclude: [/\.(png|webp|ico)$/] })]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": serverOrigin,
      "/trpc": serverOrigin,
    },
  },
}))
