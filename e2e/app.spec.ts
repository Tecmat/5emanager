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
  await page.goto('/');
  await dismissIntro(page);

  // torna alla Home e apri la card di personalizzazione
  await page.getByRole('button', { name: 'Home' }).first().click();
  await expect(page.getByText('Personalizza interfaccia').first()).toBeVisible();

  // cambia palette (swatch "Oceano"): il :root prende il nuovo --accent
  await page.getByRole('button', { name: 'Oceano' }).click();
  const accent = await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'));
  expect(accent.toLowerCase()).toBe('#4f9dd8');

  // set icone Lucide: un'icona della tab Home diventa il componente lucide (svg con path di Lucide)
  await page.getByRole('combobox').nth(1).selectOption('lucide');
  await expect(page.locator('nav.tabs svg').first()).toBeVisible();

  // nascondi la tab "Contenuti custom": resta solo home/campagna/p2p nel menu principale
  const customRow = page.locator('div.row', { hasText: 'Contenuti custom' }).last();
  await customRow.getByRole('checkbox').uncheck();
  await expect(page.locator('nav.tabs button', { hasText: 'Contenuti custom' })).toHaveCount(0);
  await expect(page.locator('nav.tabs button', { hasText: 'Campagna' })).toHaveCount(1);
});
