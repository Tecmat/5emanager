// @vitest-environment jsdom
/**
 * Test gate setup primo avvio (v0.1.72): sulla webapp servita dal server Docker
 * il setup client (scelta "server remoto / solo locale") NON deve apparire —
 * lì bastano il login (require-auth) e il primo setup admin /setup lato server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isServerWebapp } from '../src/net.js';
import { isSetupDone, SETUP_KEY, shouldShowClientSetup } from '../src/SetupPage.js';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shouldShowClientSetup', () => {
  it('webapp servita dal server (porta != 5173): mai setup client', () => {
    expect(isServerWebapp()).toBe(true); // jsdom di default: http://localhost:3000/
    expect(isSetupDone()).toBe(false);
    expect(shouldShowClientSetup(false)).toBe(false);
    localStorage.setItem(SETUP_KEY, '1');
    expect(shouldShowClientSetup(true)).toBe(false);
  });

  it('app/dev (porta 5173 o nativa): setup finché non è fatto', () => {
    // simula la porta dev di vite (5173): isServerWebapp() legge location a runtime
    vi.stubGlobal('location', { ...window.location, host: 'localhost:5173', port: '5173', protocol: 'http:' });
    expect(isServerWebapp()).toBe(false);
    expect(shouldShowClientSetup(false)).toBe(true);
    localStorage.setItem(SETUP_KEY, '1');
    expect(isSetupDone()).toBe(true);
    expect(shouldShowClientSetup(true)).toBe(false);
  });
});
