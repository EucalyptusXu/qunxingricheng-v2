import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { devApi } from './vite-plugin-dev-api'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  // devApi：本地开发用 Vite 中间件托管 /api/*（与 Vercel 生产同一批 handler，
  // 服务端 Key 走 .env.local 的 UPSTREAM_API_KEY，不进浏览器产物）
  plugins: [inspectAttr(), react(), devApi()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
