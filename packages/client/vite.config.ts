import { defineConfig, type PluginOption } from "vite"
import react from "@vitejs/plugin-react"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import { compression } from "vite-plugin-compression2"
import { VitePWA } from "vite-plugin-pwa"
import path from "node:path"

const serverOrigin = `http://localhost:${process.env.E2E_SERVER_PORT ?? "3001"}`

export default defineConfig(({ command }) => ({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }) as PluginOption,
    react() as PluginOption,
    // Precache the built app shell so the SPA boots with no network. App data lives in IndexedDB,
    // not the SW cache; API calls (/trpc, /api, /health) are never cached or navigation-fallback'd.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false,
      includeAssets: ["favicon.svg"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/trpc/, /^\/health/],
        cleanupOutdatedCaches: true,
      },
    }) as PluginOption,
    ...(command === "build"
      ? [compression({ algorithms: ["gzip"], exclude: [/\.(png|webp|ico)$/] }) as PluginOption]
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
