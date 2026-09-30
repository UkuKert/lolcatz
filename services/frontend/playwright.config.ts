import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3101",
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101",
    timeout: 60_000,
    env: {
      NEXT_PUBLIC_DEV_AUTH_TOKEN: "",
      NEXTAUTH_URL: "http://127.0.0.1:3101",
      NEXTAUTH_SECRET: "browser-test-only",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
