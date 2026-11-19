import type { Character, Currency, InventoryItem } from '../types.js';
import type { Registry } from '../registry.js';

export const COPPER_VALUE: Record<keyof Currency, number> = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };

export function currencyToCopper(c: Currency): number {
  return c.cp * 1 + c.sp * 10 + c.ep * 50 + c.gp * 100 + c.pp * 1000;
}

export function addCurrency(char: Character, amount: Partial<Currency>): Character {
  const next = { ...char, currency: { ...char.currency } };
  for (const [k, v] of Object.entries(amount) as [keyof Currency, number][]) {
    next.currency[k] = Math.max(0, next.currency[k] + v);
  }
  return { ...next, updatedAt: new Date().toISOString() };
}

/** peso di un oggetto incluso il contenuto dei contenitori (ricorsivo, protetto da cicli) */
export function itemTreeWeight(char: Character, itemId: string, seen = new Set<string>()): number {
  const item = char.inventory.find((i) => i.id === itemId);
  if (!item || seen.has(itemId)) return 0;
  seen.add(itemId);
  let w = item.weight * item.quantity;
  for (const child of char.inventory) {
    if (child.containerId === itemId) w += itemTreeWeight(char, child.id, seen);
  }
  return w;
}

/** peso totale: somma ricorsiva degli oggetti "radice" (senza contenitore valido) */
export function totalWeight(char: Character): number {
  const ids = new Set(char.inventory.map((i) => i.id));
  return char.inventory
    .filter((i) => !i.containerId || !ids.has(i.containerId))
    .reduce((sum, i) => sum + itemTreeWeight(char, i.id), 0);
}

/** sposta un oggetto in un contenitore (null = radice); blocca i cicli */
export function moveItemToContainer(char: Character, itemId: string, containerId: string | null): { character: Character; error?: string } {
  if (containerId) {
    if (containerId === itemId) return { character: char, error: 'Un oggetto non può contenere se stesso' };
    // niente cicli: il contenitore non deve essere (transitivamente) dentro l'oggetto
    let cur: string | undefined = containerId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === itemId) return { character: char, error: 'Ciclo non valido: il contenitore è dentro l\'oggetto' };
      seen.add(cur);
      cur = char.inventory.find((i) => i.id === cur)?.containerId;
    }
  }
  return { character: updateItem(char, itemId, { containerId: containerId ?? undefined }) };
}

/** spende una carica dell'oggetto (pozioni, bacchette...) */
export function useCharge(char: Character, itemId: string): { character: Character; error?: string } {
  const item = char.inventory.find((i) => i.id === itemId);
  if (!item) return { character: char, error: 'Oggetto non trovato' };
  if (!item.charges) return { character: char, error: 'Questo oggetto non ha cariche' };
  if (item.charges.current <= 0) return { character: char, error: `${item.name}: 0 cariche rimaste` };
  return { character: updateItem(char, itemId, { charges: { ...item.charges, current: item.charges.current - 1 } }) };
}

/** ricarica un oggetto (tutte le cariche, o +amount) */
export function rechargeItem(char: Character, itemId: string, amount?: number): { character: Character; error?: string } {
  const item = char.inventory.find((i) => i.id === itemId);
  if (!item) return { character: char, error: 'Oggetto non trovato' };
  if (!item.charges) return { character: char, error: 'Questo oggetto non ha cariche' };
  const current = amount === undefined ? item.charges.max : Math.min(item.charges.max, item.charges.current + amount);
  return { character: updateItem(char, itemId, { charges: { ...item.charges, current } }) };
}

/** imposta le cariche dell'oggetto (max e current) */
export function setCharges(char: Character, itemId: string, max: number): { character: Character; error?: string } {
  const item = char.inventory.find((i) => i.id === itemId);
  if (!item) return { character: char, error: 'Oggetto non trovato' };
  return { character: updateItem(char, itemId, { charges: { current: max, max } }) };
}

export const MAX_ATTUNEMENT = 3;

export function attunedCount(char: Character): number {
  return char.inventory.filter((i) => i.attuned).length;
}

export function addItem(char: Character, item: Omit<InventoryItem, 'id'> & { id?: string }): { character: Character; error?: string } {
  const id = item.id ?? `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const next: Character = { ...char, inventory: [...char.inventory, { ...item, id }], updatedAt: new Date().toISOString() };
  return { character: next };
}

export function setEquipped(char: Character, itemId: string, equipped: boolean): Character {
  return {
    ...char,
    inventory: char.inventory.map((i) => {
      if (i.id !== itemId) return i;
      return { ...i, equipped };
    }),
    updatedAt: new Date().toISOString(),
  };
}

export function setAttuned(char: Character, itemId: string, attuned: boolean, reg?: Registry): { character: Character; error?: string } {
  const item = char.inventory.find((i) => i.id === itemId);
  if (!item) return { character: char, error: 'Oggetto non trovato' };
  if (!item.magic) return { character: char, error: 'Solo oggetti magici richiedono sintonizzazione' };
  if (attuned && !char.houseRules.bypassAttunementLimit && attunedCount(char) >= MAX_ATTUNEMENT && !item.attuned) {
    return { character: char, error: `Sintonizzazione massima (${MAX_ATTUNEMENT}) raggiunta` };
  }
  const next: Character = {
    ...char,
    inventory: char.inventory.map((i) => (i.id === itemId ? { ...i, attuned } : i)),
    updatedAt: new Date().toISOString(),
  };
  return { character: next };
}

export function removeItem(char: Character, itemId: string): Character {
  return { ...char, inventory: char.inventory.filter((i) => i.id !== itemId), updatedAt: new Date().toISOString() };
}

export function updateItem(char: Character, itemId: string, patch: Partial<InventoryItem>): Character {
  return {
    ...char,
    inventory: char.inventory.map((i) => (i.id === itemId ? { ...i, ...patch, id: itemId } : i)),
    updatedAt: new Date().toISOString(),
  };
}

/** vende 1 unità dell'oggetto al suo valueGp: aggiorna la valuta e decrementa/rimuove l'oggetto */
export function sellItem(char: Character, itemId: string): { character: Character; gainedGp: number; error?: string } {
  const item = char.inventory.find((i) => i.id === itemId);
  if (!item) return { character: char, gainedGp: 0, error: 'Oggetto non trovato' };
  const value = item.valueGp ?? 0;
  if (value <= 0) return { character: char, gainedGp: 0, error: `${item.name} non ha un valore (imposta "valore MO")` };
  let next = addCurrency(char, { gp: value });
  if (item.quantity > 1) next = updateItem(next, itemId, { quantity: item.quantity - 1 });
  else next = removeItem(next, itemId);
  return { character: next, gainedGp: value };
}

/** valore totale del tesoro del PG in monete d'oro (valuta + valore degli oggetti) */
export function totalTreasureGp(char: Character): number {
  return currencyToCopper(char.currency) / 100 + char.inventory.reduce((s, i) => s + (i.valueGp ?? 0) * i.quantity, 0);
}

/** somma in rame di una valuta (utile per la tesoreria di gruppo) */
export function addCurrencyRaw(c: Currency, amount: Partial<Currency>): Currency {
  const next = { ...c };
  for (const [k, v] of Object.entries(amount) as [keyof Currency, number][]) {
    next[k] = Math.max(0, next[k] + v);
  }
  return next;
}
