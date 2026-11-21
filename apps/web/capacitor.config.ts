import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tecmat.emanager',
  appName: '5e Manager',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // true: l'app gira su https://localhost (Capacitor) ma deve parlare in chiaro con la LAN
    // (http://<ip>:3001/api/info, ws://<ip>:3177/ws) — senza questo il WebView blocca tutto come mixed-content
    allowMixedContent: true,
  },
};

export default config;
