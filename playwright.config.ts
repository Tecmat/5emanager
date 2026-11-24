import { defineConfig } from '@playwright/test';

/**
 * E2E Playwright (v0.1.71): serve la build di produzione (vite preview) e testa
 * i flussi principali dell'app in Chromium headless. Vedi docs/ROADMAP.md Fase 3.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1, // il secondo test ha mostrato flake (timeout al primo render headless): un retry lo stabilizza
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npm run build -w @dnd5e/web && npm run preview -w @dnd5e/web -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
