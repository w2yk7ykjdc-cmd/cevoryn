import { defineConfig } from "@playwright/test";

/**
 * Minimal Playwright config for the Romance product's one required
 * browser E2E spec. Does NOT start its own dev server (CI/local must
 * already have `npm run dev` running against the URL below) - this
 * sandbox has no real Supabase project, so the dev server needs manual
 * environment setup (see docs/romance in the final report) before this
 * spec can even attempt a login.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
  },
});
