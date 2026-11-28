import { expect, test, type Page } from '@playwright/test';
import WebSocket from 'ws';
import type { Character } from '@dnd5e/core';

// nota: niente import di @dnd5e/data-srd qui (i suoi JSON non si caricano sotto il loader Node di Playwright):
// la scheda del player è un oggetto Character completo costruito a mano
const PLAYER_CHAR: Character = {
  id: 'player-ws-1',
  houseRules: {},
  name: 'PlayerWS',
  raceId: 'human',
  xp: 0,
  inspiration: false,
  abilityScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  classLevels: [{ classId: 'fighter', level: 1, hitDiceRolled: [10] }],
  proficiency: { skills: ['athletics', 'perception'], expertise: [], weapons: ['simple', 'martial'], armors: ['light', 'medium', 'heavy', 'shield'], tools: [], languages: ['comune'] },
  fightingStyles: [],
  feats: [],
  features: ['second-wind'],
  spellsKnown: [],
  spellsPrepared: [],
  spellSlots: {},
  inventory: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
  hp: { current: 11, temp: 0 },
  deathSaves: { successes: 0, failures: 0 },
  conditions: [],
  journal: [],
  favoriteSpells: [],
  exhaustion: 0,
  spellsPreparedByClass: {},
  notes: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * E2E multiplayer (v0.1.98): il server di gioco gira su 127.0.0.1:3999 (webServer in playwright.config).
 * L'host crea la campagna dall'app (UI), un giocatore entra via WebSocket diretto (protocollo del server)
 * e carica la scheda: il master dà XP a tutta la party e il player lo vede nello stato.
 */

const SERVER = 'ws://127.0.0.1:3999';

async function dismissIntro(page: Page) {
  const start = page.getByRole('button', { name: 'Inizia' });
  if (await start.isVisible().catch(() => false)) await start.click();
  const skip = page.getByRole('button', { name: 'Salta' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test('multiplayer: host crea campagna via UI, player entra via WS e riceve gli XP dal master', async ({ page }) => {
  test.setTimeout(120_000);

  // ---- host: crea una scheda e poi la campagna sul server 127.0.0.1:3999 ----
  await page.goto('/');
  await dismissIntro(page);
  await page.getByRole('button', { name: 'Nuova scheda' }).first().click();
  await page.getByPlaceholder('Aldric il Coraggioso').fill('Host E2E');
  await page.getByRole('button', { name: 'Crea personaggio' }).click();
  await expect(page.locator('header h1')).toContainText('Host E2E');

  // dalla vista scheda si torna al menu principale (tasto "Home") e poi alla tab Campagna
  await page.getByRole('button', { name: 'Home' }).first().click();
  await page.getByRole('button', { name: 'Campagna' }).first().click();
  await page.getByPlaceholder('ws://localhost:3001').fill(SERVER);
  await page.getByPlaceholder('Eroe').fill('Host');
  await page.getByPlaceholder('La tomba perduta').fill('E2E Multiplayer');
  await page.getByRole('button', { name: 'Crea e entra' }).click();

  // attende l'ingresso in campagna e legge l'id (8 caratteri) dall'header
  const campHeader = page.locator('h3', { hasText: 'E2E Multiplayer' }).first();
  await expect(campHeader).toBeVisible();
  const m = /id\s+([A-Za-z0-9-]{6,12})/.exec((await campHeader.textContent()) ?? '');
  expect(m, `id campagna non trovato in: ${await campHeader.textContent()}`).toBeTruthy();
  const campaignId = m![1];

  // ---- player: entra via WS e carica la sua scheda ----
  const ch = PLAYER_CHAR;

  console.log('campaignId estratto dall UI:', campaignId);
  const ws = new WebSocket(SERVER);
  const received: Record<string, unknown>[] = [];
  const waitFor = (pred: (m: Record<string, unknown>) => boolean, ms = 20_000, what = 'messaggio') =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const hit = received.find(pred);
      if (hit) return resolve(hit);
      const timer = setTimeout(
        () => reject(new Error(`timeout (${what}) in attesa del messaggio WS; ricevuti: ${JSON.stringify(received)}`)),
        ms,
      );
      const onMsg = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        received.push(msg);
        if (pred(msg)) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(msg);
        }
      };
      ws.on('message', onMsg);
    });
  await new Promise<void>((res, rej) => { ws.on('open', () => res()); ws.on('error', rej); });

  ws.send(JSON.stringify({ t: 'join', campaignId, password: '', name: 'PlayerWS' }));
  const welcome = (await waitFor((x) => x.t === 'welcome' || x.t === 'error', 20_000, 'welcome/errore join')) as { t: string; you?: { id: string }; message?: string };
  if (welcome.t === 'error') throw new Error(`join rifiutato dal server: ${welcome.message}`);
  const playerId = welcome.you!.id;
  console.log('player entrato, id:', playerId);

  ws.send(JSON.stringify({ t: 'action', action: { kind: 'setCharacter', character: ch } }));
  await waitFor((x) => x.t === 'state' && !!(x.campaign as { characters: Record<string, unknown> }).characters[playerId], 20_000, 'state con setCharacter');

  // ---- l'host vede il player nella UI della campagna ----
  await expect(page.getByText('PlayerWS').first()).toBeVisible();

  // ---- il master dà +300 XP a tutta la party: il player lo riceve nello stato ----
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const xpBtn = page.getByRole('button', { name: /XP a tutta la party/ });
  await expect(xpBtn).toBeVisible();
  await xpBtn.scrollIntoViewIfNeeded();
  await xpBtn.click();
  let st: { campaign: { characters: Record<string, { xp: number }> } };
  try {
    st = (await waitFor(
      (x) => x.t === 'state' && ((x.campaign as { characters: Record<string, { xp?: number }> }).characters[playerId]?.xp ?? 0) >= 300,
      30_000,
      'state con XP 300',
    )) as { campaign: { characters: Record<string, { xp: number }> } };
  } catch (e) {
    const banner = await page.locator('.error, .notice').allTextContents().catch(() => []);
    throw new Error(`${(e as Error).message} | banner pagina: ${JSON.stringify(banner)} | pageerrors: ${JSON.stringify(pageErrors)}`);
  }
  expect(st.campaign.characters[playerId].xp).toBe(300);

  ws.close();
});
