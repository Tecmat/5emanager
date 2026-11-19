import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// mock dell'API GitHub + server 5emanager con DND5E_GH_API che punta al mock
let ghMock: Server;
let ghPort: number;
let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let port: number;

const RELEASE = {
  tag_name: 'v9.9.9',
  html_url: 'https://github.com/Tecmat/5emanager/releases/tag/v9.9.9',
  assets: [
    { id: 1, name: 'app-debug.apk', browser_download_url: 'https://example.invalid/app-debug.apk' },
    { id: 2, name: '5e.Manager_9.9.9_amd64.AppImage', browser_download_url: 'https://example.invalid/app.AppImage' },
  ],
};

beforeAll(async () => {
  process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-upd-'));
  ghMock = createServer((req, res) => {
    const auth = req.headers.authorization;
    if (req.url === '/repos/Tecmat/5emanager/releases/latest') {
      // con token must be presente (repo privato simulato)
      if (!auth?.startsWith('Bearer ')) {
        res.writeHead(404).end('{"message":"Not Found"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(RELEASE));
      return;
    }
    if (req.url === '/repos/Tecmat/5emanager/releases/assets/1') {
      if (req.headers.accept !== 'application/octet-stream') { res.writeHead(406).end(); return; }
      if (!auth?.startsWith('Bearer ')) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': '7' }).end('APKDATA');
      return;
    }
    res.writeHead(404).end('nope');
  });
  await new Promise<void>((r) => ghMock.listen(0, '127.0.0.1', r));
  ghPort = (ghMock.address() as any).port;
  process.env.DND5E_GH_API = `http://127.0.0.1:${ghPort}`;
  process.env.GITHUB_TOKEN = 'test-token';
  const mod = await import('../src/index.js');
  server = await mod.createDndServer(0, '127.0.0.1');
  port = server.port;
});

afterAll(async () => {
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
  await new Promise((r) => ghMock.close(r));
}, 20000);

describe('/api/update (repo privato con token)', () => {
  it('ritorna l\'ultima release con gli asset', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/update`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.tag).toBe('v9.9.9');
    expect(j.assets.map((a: any) => a.name)).toContain('app-debug.apk');
  });

  it('fa da proxy per il download dell\'asset', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/update/asset?name=app-debug.apk`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('app-debug.apk');
    expect(await r.text()).toBe('APKDATA');
  });

  it('rifiuta nomi asset sospetti (path traversal)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/update/asset?name=..%2F..%2Fetc`);
    expect(r.status).toBe(400);
  });

  it('404 per asset inesistente', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/update/asset?name=nope.txt`);
    expect(r.status).toBe(404);
  });
});
