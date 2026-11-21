import { defineConfig } from 'vitest/config';

// test UI (jsdom) della web app — separati dai test unit dei package (vitest.config.ts)
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['apps/web/test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
