/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the browser talks to Vite (5173) and Vite forwards /api to Express (3001).
// That means no CORS setup is needed while developing.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": { target: "http://localhost:3001", changeOrigin: false } } },
  build: { modulePreload: { polyfill: false } },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"] },
});
