import type { Character, CraftingIngredient, CraftingRecipe, Currency, EquipSlot, InventoryItem, ShopItem } from '../types.js';
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

/** slot di equipaggiamento standard */
export const EQUIP_SLOTS: { id: EquipSlot; name: string }[] = [
  { id: 'head', name: 'Testa' },
  { id: 'amulet', name: 'Amuleto' },
  { id: 'cloak', name: 'Mantello' },
  { id: 'armor', name: 'Armatura' },
  { id: 'gloves', name: 'Guanti' },
  { id: 'belt', name: 'Cintura' },
  { id: 'boots', name: 'Stivali' },
  { id: 'ring1', name: 'Anello 1' },
  { id: 'ring2', name: 'Anello 2' },
  { id: 'shield', name: 'Scudo' },
  { id: 'hand1', name: 'Mano 1' },
  { id: 'hand2', name: 'Mano 2' },
];

/** slot occupato da un oggetto (esplicito o derivato dal tipo) */
export function slotOfItem(item: InventoryItem): EquipSlot | null {
  if (item.slot) return item.slot;
  if (item.kind === 'armor') return 'armor';
  if (item.kind === 'shield') return 'shield';
  return null;
}

/** assegna lo slot a un oggetto; se lo slot è occupato da un altro oggetto equipaggiato, quello viene disequipaggiato */
export function setItemSlot(char: Character, itemId: string, slot: EquipSlot | null): Character {
  return {
    ...char,
    inventory: char.inventory.map((i) => {
      if (i.id === itemId) return { ...i, slot: slot ?? undefined };
      if (slot && i.equipped && i.id !== itemId && slotOfItem(i) === slot) return { ...i, equipped: false };
      return i;
    }),
    updatedAt: new Date().toISOString(),
  };
}

function freeHandSlot(items: InventoryItem[], exceptId: string): 'hand1' | 'hand2' | null {
  const used = new Set(
    items.filter((i) => i.equipped && i.id !== exceptId).map((i) => slotOfItem(i)).filter((s): s is EquipSlot => !!s),
  );
  if (!used.has('hand1')) return 'hand1';
  if (!used.has('hand2')) return 'hand2';
  return null;
}

export function setEquipped(char: Character, itemId: string, equipped: boolean): Character {
  const item = char.inventory.find((i) => i.id === itemId);
  if (!item) return char;
  if (!equipped) {
    return {
      ...char,
      inventory: char.inventory.map((i) => (i.id === itemId ? { ...i, equipped: false } : i)),
      updatedAt: new Date().toISOString(),
    };
  }
  // equipaggia: determina lo slot (le armi vanno nella prima mano libera) e libera lo slot dagli altri oggetti
  let slot = slotOfItem(item);
  if (item.kind === 'weapon' && !item.slot) slot = freeHandSlot(char.inventory, itemId);
  return {
    ...char,
    inventory: char.inventory.map((i) => {
      if (i.id === itemId) return { ...i, equipped: true, ...(slot ? { slot } : {}) };
      if (slot && i.equipped && slotOfItem(i) === slot) return { ...i, equipped: false };
      return i;
    }),
    updatedAt: new Date().toISOString(),
  };
}

/** conflitti di equipaggiamento: più oggetti equipaggiati nello stesso slot */
export function equipConflicts(char: Character): { slot: EquipSlot; itemIds: string[] }[] {
  const bySlot = new Map<EquipSlot, string[]>();
  for (const i of char.inventory) {
    if (!i.equipped) continue;
    const s = slotOfItem(i);
    if (!s) continue;
    bySlot.set(s, [...(bySlot.get(s) ?? []), i.id]);
  }
  return [...bySlot.entries()].filter(([, ids]) => ids.length > 1).map(([slot, itemIds]) => ({ slot, itemIds }));
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

// ---------------------------------------------------------------------------
// Negozio e crafting (tabelle shop/crafting di data-srd)
// ---------------------------------------------------------------------------

/** denominazioni in rame, dalla più grande alla più piccola (canoniche: 1|10|50|100|1000) */
const DENOMS: [keyof Currency, number][] = [['pp', 1000], ['gp', 100], ['ep', 50], ['sp', 10], ['cp', 1]];

/** converte una somma in rame nella combinazione di monete (ae, mo, me, ma, mr) */
export function copperToCurrency(copper: number): Currency {
  const out: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  let rest = Math.max(0, Math.round(copper));
  for (const [k, v] of DENOMS) {
    out[k] = Math.floor(rest / v);
    rest %= v;
  }
  return out;
}

/** paga esattamente `costCopper` usando le monete del PG e rompendo la moneta più piccola che copre il resto; `change` = monete restituite */
export function payCopper(char: Character, costCopper: number): { character: Character; change: Currency; error?: string } {
  const cost = Math.round(costCopper);
  const zero: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  if (!Number.isFinite(cost) || cost < 0) return { character: char, change: zero, error: 'Costo non valido' };
  const have = currencyToCopper(char.currency);
  if (have < cost) {
    const fmt = (c: number) => (c / 100).toLocaleString('it-IT');
    return { character: char, change: zero, error: `Fondi insufficienti: servono ${fmt(cost)} MO, hai ${fmt(have)} MO` };
  }
  let remaining = cost;
  const purse: Currency = { ...char.currency };
  for (const [k, v] of DENOMS) {
    const use = Math.min(purse[k], Math.floor(remaining / v));
    purse[k] -= use;
    remaining -= use * v;
  }
  let change: Currency = { ...zero };
  while (remaining > 0) {
    const coin = [...DENOMS].reverse().find(([k, v]) => purse[k] > 0 && v >= remaining);
    if (!coin) break;
    const [k, v] = coin;
    purse[k] -= 1;
    const back = copperToCurrency(v - remaining);
    for (const [ck] of DENOMS) change[ck] += back[ck];
    remaining = 0;
  }
  const next: Character = { ...char, currency: purse, updatedAt: new Date().toISOString() };
  return { character: next, change };
}

/** acquista `qty` unità di un oggetto dello shop: scala il costo (con resto) e accoda/aggiunge l'oggetto */
export function buyItem(char: Character, item: ShopItem, qty = 1): { character: Character; change: Currency; spentGp: number; error?: string } {
  const zero: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  if (!Number.isFinite(qty) || qty <= 0) return { character: char, change: zero, spentGp: 0, error: 'Quantità non valida' };
  const q = Math.floor(qty);
  const costCopper = Math.round(item.valueGp * 100) * q;
  const paid = payCopper(char, costCopper);
  if (paid.error) return { character: char, change: zero, spentGp: 0, error: paid.error };
  const norm = item.name.trim().toLowerCase();
  const existing = paid.character.inventory.find((i) => !i.containerId && i.kind === item.kind && i.name.trim().toLowerCase() === norm);
  let next = paid.character;
  if (existing) {
    next = updateItem(next, existing.id, { quantity: existing.quantity + q });
  } else {
    const r = addItem(next, {
      name: item.name, kind: item.kind, quantity: q, weight: item.weight, equipped: false,
      magic: item.magic ?? false, attuned: false, valueGp: item.valueGp, rarity: item.rarity,
    });
    if (r.error) return { character: char, change: zero, spentGp: 0, error: r.error };
    next = r.character;
  }
  return { character: next, change: paid.change, spentGp: item.valueGp * q };
}

/** ingredienti mancanti per una ricetta (contati per nome sull'inventario) */
export function missingIngredients(char: Character, recipe: CraftingRecipe): CraftingIngredient[] {
  const missing: CraftingIngredient[] = [];
  for (const ing of recipe.ingredients) {
    const have = char.inventory
      .filter((i) => i.name.trim().toLowerCase() === ing.name.trim().toLowerCase())
      .reduce((sum, i) => sum + i.quantity, 0);
    if (have < ing.quantity) missing.push({ name: ing.name, quantity: ing.quantity - have });
  }
  return missing;
}

/** crea l'oggetto della ricetta: consuma gli ingredienti, scala il costo in oro (con resto) e aggiunge il risultato */
export function craftItem(char: Character, recipe: CraftingRecipe): { character: Character; change: Currency; error?: string } {
  const zero: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const missing = missingIngredients(char, recipe);
  if (missing.length) {
    const list = missing.map((m) => `${m.name} (mancano ${m.quantity})`).join(', ');
    return { character: char, change: zero, error: `Ingredienti mancanti: ${list}` };
  }
  const paid = payCopper(char, Math.round(recipe.costGp * 100));
  if (paid.error) return { character: char, change: zero, error: paid.error };
  let next = paid.character;
  const need = new Map(recipe.ingredients.map((i) => [i.name.trim().toLowerCase(), i.quantity]));
  for (const item of [...next.inventory]) {
    const n = need.get(item.name.trim().toLowerCase());
    if (n === undefined) continue;
    const take = Math.min(n, item.quantity);
    need.set(item.name.trim().toLowerCase(), n - take);
    next = take >= item.quantity ? removeItem(next, item.id) : updateItem(next, item.id, { quantity: item.quantity - take });
  }
  const res = addItem(next, {
    ...recipe.result,
    quantity: recipe.result.quantity ?? 1,
    equipped: false,
    attuned: false,
    magic: recipe.result.magic ?? false,
  });
  if (res.error) return { character: char, change: zero, error: res.error };
  return { character: res.character, change: paid.change };
}
