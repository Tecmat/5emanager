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
  webServer: [
    {
      command: 'npm run build -w @dnd5e/web && npm run preview -w @dnd5e/web -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // server di gioco reale per i test multiplayer (dati in /tmp, porta 3999)
      command: 'sh -c "rm -rf /tmp/dnd5e-e2e-data && mkdir -p /tmp/dnd5e-e2e-data && PORT=3999 DND5E_DATA_DIR=/tmp/dnd5e-e2e-data npx tsx packages/server/src/index.ts"',
      url: 'http://127.0.0.1:3999/api/info',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
