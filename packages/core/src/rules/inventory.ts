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

export function totalWeight(char: Character): number {
  return char.inventory.reduce((sum, i) => sum + i.weight * i.quantity, 0);
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
