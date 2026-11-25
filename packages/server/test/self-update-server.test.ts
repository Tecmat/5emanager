import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Self-update del SERVER da pagina admin (POST /api/update/apply?what=server):
 *  - dentro Docker o senza .git -> 409 con le istruzioni giuste (in Docker si aggiorna l'immagine)
 *  - da checkout git -> git fetch + checkout tag release + npm ci (solo se lock cambiato) + rebuild web
 *  - working tree sporco -> 409 (salvo force=1); tag non valido -> 400
 *  - GET /api/update espone deployment ('docker'|'git'|'dir') per far vedere il pulsante giusto in /admin
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-selfupd-'));
process.env.DND5E_APP_ROOT = mkdtempSync(join(tmpdir(), 'dnd5e-approot-')); // niente .git -> mode 'dir'
process.env.DND5E_ADMIN_TOKEN = 'adm-tok';

const RELEASE = {
  tag_name: 'v9.9.9',
  html_url: 'https://github.com/Tecmat/5emanager/releases/tag/v9.9.9',
  assets: [{ id: 3, name: 'web-dist.zip', browser_download_url: 'https://example.invalid/web-dist.zip' }],
};

let ghMock: Server;
let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let base: string;
let api: typeof import('../src/update-api.js');

beforeAll(async () => {
  ghMock = createServer((req, res) => {
    if (req.url === '/repos/Tecmat/5emanager/releases/latest') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(RELEASE));
      return;
    }
    res.writeHead(404).end('nope');
  });
  await new Promise<void>((r) => ghMock.listen(0, '127.0.0.1', r));
  process.env.DND5E_GH_API = `http://127.0.0.1:${(ghMock.address() as any).port}`;
  delete process.env.GITHUB_TOKEN;
  const mod = await import('../src/index.js');
  server = await mod.createDndServer(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.port}`;
  api = await import('../src/update-api.js');
});

afterAll(async () => {
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
  ghMock.close();
}, 20000);

function fakeGitRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dnd5e-git-'));
  mkdirSync(join(root, '.git'));
  return root;
}

function recordingRun(canned: Record<string, string>) {
  const calls: { cmd: string; args: string[] }[] = [];
  const run = async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const key = `${cmd} ${args.join(' ')}`;
    for (const [k, v] of Object.entries(canned)) if (key.startsWith(k)) return v;
    return '';
  };
  return { calls, run };
}

describe('deploymentMode', () => {
  it('docker se /.dockerenv esiste (flag iniettabile nei test)', () => {
    expect(api.deploymentMode('/tmp/qualunque', true)).toBe('docker');
  });
  it('git se esiste .git nella root, altrimenti dir', () => {
    expect(api.deploymentMode(fakeGitRoot(), false)).toBe('git');
    expect(api.deploymentMode(mkdtempSync(join(tmpdir(), 'dnd5e-nogit-')), false)).toBe('dir');
  });
});

describe('applyServerUpdate (logica git, run fittizio)', () => {
  it('in Docker (o senza .git) rifiuta con 409 e le istruzioni per il container', async () => {
    await expect(api.applyServerUpdate('v9.9.9', { docker: true, root: '/tmp/x' })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Docker') });
    await expect(api.applyServerUpdate('v9.9.9', { root: mkdtempSync(join(tmpdir(), 'dnd5e-nogit-')), docker: false })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('tag non valido -> 400', async () => {
    await expect(api.applyServerUpdate('v9.9.9; rm -rf /', { root: fakeGitRoot(), docker: false, run: async () => '' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('working tree sporco -> 409 (salvo force=1)', async () => {
    const dirty = recordingRun({ 'git status --porcelain': ' M file.ts' });
    await expect(api.applyServerUpdate('v9.9.9', { root: fakeGitRoot(), docker: false, run: dirty.run })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('non pulito') });
    const forced = recordingRun({ 'git status --porcelain': ' M file.ts', 'git rev-parse': 'abc1234', 'git diff': 'package.json' });
    const r = await api.applyServerUpdate('v9.9.9', { force: true, root: fakeGitRoot(), docker: false, run: forced.run });
    expect(r.restartRequired).toBe(true);
    expect(r.from).toBe('abc1234');
    expect(forced.calls.map((c) => c.args[0])).toEqual(['status', 'rev-parse', 'fetch', 'checkout', 'diff', 'run']);
  });

  it('happy path: fetch + checkout tag + npm ci solo se il lock e\' cambiato + build web', async () => {
    const withLock = recordingRun({ 'git rev-parse': 'abc1234', 'git diff': 'package.json\npackage-lock.json' });
    const r1 = await api.applyServerUpdate('v9.9.9', { root: fakeGitRoot(), docker: false, run: withLock.run });
    expect(r1.lockChanged).toBe(true);
    expect(withLock.calls.some((c) => c.cmd === 'npm' && c.args[0] === 'ci')).toBe(true);
    expect(withLock.calls.some((c) => c.cmd === 'npm' && c.args.join(' ').includes('build'))).toBe(true);
    expect(withLock.calls.find((c) => c.args[0] === 'checkout')?.args).toContain('v9.9.9');

    const noLock = recordingRun({ 'git rev-parse': 'abc1234', 'git diff': 'apps/web/src/App.tsx' });
    const r2 = await api.applyServerUpdate('v9.9.9', { root: fakeGitRoot(), docker: false, run: noLock.run });
    expect(r2.lockChanged).toBe(false);
    expect(noLock.calls.some((c) => c.cmd === 'npm' && c.args[0] === 'ci')).toBe(false);
  });
});

describe('POST /api/update/apply?what=server (HTTP)', () => {
  it('senza .git (DND5E_APP_ROOT di test) -> 409 con il messaggio, non esegue git', async () => {
    const r = await fetch(base + '/api/update/apply?what=server', { method: 'POST', headers: { 'x-admin-token': 'adm-tok' } });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toContain('self-update');
  });

  it('senza token admin -> 401', async () => {
    const r = await fetch(base + '/api/update/apply?what=server', { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('GET /api/update espone deployment e selfUpdate per la UI di /admin', async () => {
    const r = await fetch(base + '/api/update');
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.tag).toBe('v9.9.9');
    expect(j.deployment).toBe('dir');
    expect(j.selfUpdate).toBe(false);
  });
});
