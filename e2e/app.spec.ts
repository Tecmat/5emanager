import { expect, test } from '@playwright/test';

/**
 * E2E smoke (v0.1.71): setup primo avvio -> onboarding saltato -> creazione scheda ->
 * navigazione tab della scheda -> tira dado -> personalizzazione interfaccia (tema/palette).
 * UI in italiano (lingua di default).
 */

async function dismissIntro(page: import('@playwright/test').Page) {
  const start = page.getByRole('button', { name: 'Inizia' });
  if (await start.isVisible().catch(() => false)) await start.click();
  const skip = page.getByRole('button', { name: 'Salta' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test('flusso base: crea una scheda, naviga le tab e tira un dado', async ({ page }) => {
  await page.goto('/');
  await dismissIntro(page);

  // crea una nuova scheda dalla Home
  await page.getByRole('button', { name: 'Nuova scheda' }).first().click();
  await page.getByPlaceholder('Aldric il Coraggioso').fill('E2E Test');
  await page.getByRole('button', { name: 'Crea personaggio' }).click();

  // la scheda si apre: nome in header
  await expect(page.locator('header h1')).toContainText('E2E Test');

  // naviga le tab interne della scheda
  await page.getByRole('button', { name: /Incantesimi/ }).click();
  await expect(page.getByRole('heading', { name: /Incantesimi/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Inventario/ }).click();
  await expect(page.getByText(/Negozio/).first()).toBeVisible();
  await page.getByRole('button', { name: /Combattimento/ }).click();

  // torna alla panoramica e tira un dado
  await page.getByRole('button', { name: /Panoramica/ }).click();
  const diceCard = page.locator('.card', { hasText: 'Tira dado' });
  await diceCard.getByRole('button', { name: /Tira$/ }).click();
  await expect(diceCard.locator('div').filter({ hasText: /1d20 → \[/ }).first()).toBeVisible();
});

test('personalizza interfaccia: cambia palette e nasconde una tab principale', async ({ page }) => {
  test.setTimeout(90_000); // headless lento al primo render: margine extra contro i flake
  await page.goto('/');
  await dismissIntro(page);

  // torna alla Home e apri la card di personalizzazione
  await page.getByRole('button', { name: 'Home' }).first().click();
  const card = page.locator('.card', { hasText: 'Personalizza interfaccia' }).first();
  await expect(card).toBeVisible();

  // tema scuro (il runner headless parte in light con tema auto), poi palette "Oceano"
  await card.getByRole('combobox').nth(0).selectOption('dark');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.getByRole('button', { name: 'Oceano' }).click();
  const accent = await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'));
  expect(accent.toLowerCase()).toBe('#4f9dd8'); // ocean in tema scuro (in chiaro sarebbe #2273b8)

  // set icone Lucide (secondo combobox della card)
  await card.getByRole('combobox').nth(1).selectOption('lucide');
  await expect(page.locator('nav.tabs svg').first()).toBeVisible();

  // nascondi la tab "Contenuti custom": nel menu principale restano home/campagna/p2p
  const customRow = card.locator('div.row', { hasText: 'Contenuti custom' }).first();
  await customRow.getByRole('checkbox').uncheck();
  await expect(page.locator('nav.tabs button', { hasText: 'Contenuti custom' })).toHaveCount(0);
  await expect(page.locator('nav.tabs button', { hasText: 'Campagna' })).toHaveCount(1);
});

test('flusso PG: crea un mago, assegna XP, sali di livello e lancia un incantesimo', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await dismissIntro(page);

  // crea un mago dalla Home (classe = terza select del form: razza, sottorazza, classe)
  await page.getByRole('button', { name: 'Nuova scheda' }).first().click();
  const form = page.locator('form', { hasText: 'Nuovo personaggio' }).first();
  await form.getByPlaceholder('Aldric il Coraggioso').fill('E2E Mago');
  await form.locator('select').nth(2).selectOption('wizard');
  await form.getByRole('button', { name: 'Crea personaggio' }).click();
  await expect(page.locator('header h1')).toContainText('E2E Mago');

  // XP: il campo è precompilato a 300 (soglia livello 2) -> aggiungi e sali di livello
  const xpRow = page.locator('div.row', { has: page.getByRole('button', { name: 'Aggiungi XP' }) }).first();
  await xpRow.getByRole('button', { name: 'Aggiungi XP' }).click();
  await expect(page.getByText('Livello da XP: 2')).toBeVisible();
  await page.getByRole('button', { name: 'Sali di livello' }).click();
  // il mago al liv 2 deve scegliere un archetipo: seconda select del dialog (dopo la classe)
  const modal = page.locator('.modal').first();
  await modal.locator('select').nth(1).selectOption({ index: 1 });
  await modal.getByRole('button', { name: 'Conferma level-up' }).click();
  await expect(page.getByText(/livello 2 \/ 900 XP/)).toBeVisible();

  // tab Incantesimi: impara un incantesimo di 1° livello dal grimorio, poi lancialo
  await page.getByRole('button', { name: /Incantesimi/ }).click();
  const grimoire = page.locator('.card', { hasText: 'Grimorio' }).first();
  await grimoire.getByPlaceholder('Cerca incantesimo...').fill('affascina');
  await grimoire.locator('tr', { hasText: 'Affascinare Persona' }).first().getByRole('button', { name: 'Impara' }).click();
  await page.getByRole('button', { name: 'Lancia', exact: true }).first().click();

  // il lancio finisce nel diario di sessione in Panoramica
  await page.getByRole('button', { name: /Panoramica/ }).click();
  await expect(page.getByText(/Lancia .+ \(slot 1°\)/).first()).toBeVisible();
});
