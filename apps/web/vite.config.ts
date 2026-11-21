import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// versione della build iniettata nel bundle: fallback quando /version.json non è servito (es. webapp vecchia)
const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173 },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
});
