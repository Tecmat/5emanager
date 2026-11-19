import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// test di /api/update/apply: il server scarica web-dist.zip dal mock GitHub e sostituisce dist/
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-selfupd-'));
const staticDir = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(staticDir, { recursive: true });
writeFileSync(join(staticDir, 'index.html'), '<html>OLD</html>');
process.env.DND5E_STATIC_DIR = staticDir;
process.env.DND5E_ADMIN_TOKEN = 'adm-test';

/** zip minimale (entry stored, senza compressione) */
function makeZip(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([c, nameBuf]));
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const ZIP = makeZip({ 'index.html': '<html>NEW v9.9.9</html>', 'assets/app.js': 'console.log(1)' });

let ghMock: Server;
let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let port: number;

beforeAll(async () => {
  ghMock = createServer((req, res) => {
    if (req.url === '/repos/Tecmat/5emanager/releases/latest') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          tag_name: 'v9.9.9',
          html_url: 'https://example.invalid/rel',
          assets: [{ id: 7, name: 'web-dist.zip', browser_download_url: 'https://example.invalid/web-dist.zip' }],
        }),
      );
      return;
    }
    if (req.url === '/repos/Tecmat/5emanager/releases/assets/7') {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': String(ZIP.length) }).end(ZIP);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => ghMock.listen(0, '127.0.0.1', r));
  process.env.DND5E_GH_API = `http://127.0.0.1:${(ghMock.address() as any).port}`;
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

describe('POST /api/update/apply (self-update web app)', () => {
  it('senza token admin → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/update/apply`, { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('con token: sostituisce dist/ con la nuova build (e fa backup)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/update/apply`, {
      method: 'POST',
      headers: { 'x-admin-token': 'adm-test' },
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.version).toBe('v9.9.9');
    expect(readFileSync(join(staticDir, 'index.html'), 'utf8')).toBe('<html>NEW v9.9.9</html>');
    expect(existsSync(join(staticDir, 'assets', 'app.js'))).toBe(true);
    expect(existsSync(staticDir + '.bak')).toBe(true); // backup della vecchia
    expect(readFileSync(join(staticDir + '.bak', 'index.html'), 'utf8')).toBe('<html>OLD</html>');
    // la pagina servita ora è la nuova
    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(await page.text()).toContain('NEW v9.9.9');
  });
});
