import {
  ABILITIES,
  armorClass,
  maxHp,
  passivePerception,
  proficiencyBonus,
  savingThrowBonus,
  skillBonus,
  spellcastingInfoAll,
  speedOf,
  totalLevel,
  type Character,
  type Registry,
} from '@dnd5e/core';
import { SKILLS } from '@dnd5e/core';

const AB_IT: Record<string, string> = { str: 'Forza', dex: 'Destrezza', con: 'Costituzione', int: 'Intelligenza', wis: 'Saggezza', cha: 'Carisma' };

const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC_MAP[c] ?? c);
}

function fmt(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** HTML stampabile della scheda; poi window.print() */
export function buildSheetHtml(char: Character, reg: Registry): string {
  const level = totalLevel(char);
  const pb = proficiencyBonus(level);
  const ac = armorClass(char, reg).ac;
  const hpMax = maxHp(char, reg);
  const race = reg.races.get(char.raceId);
  const classes = char.classLevels.map((cl) => `${reg.classes.get(cl.classId)?.name ?? cl.classId} ${cl.level}`).join(' / ');
  const spellInfo = spellcastingInfoAll(char, reg);
  const known = char.spellsKnown.map((id) => reg.spells.get(id)).filter(Boolean);
  const prepared = char.spellsPrepared.map((id) => reg.spells.get(id)?.name ?? id);

  const abilities = ABILITIES.map((ab) => {
    const v = char.abilityScores[ab];
    return `<td><b>${AB_IT[ab]}</b><br>${v}<br><span class="mod">${fmt(Math.floor((v - 10) / 2))}</span></td>`;
  }).join('');

  const saves = ABILITIES.map((ab) => `<tr><td>${AB_IT[ab]}</td><td>${fmt(savingThrowBonus(char, ab, reg))}</td></tr>`).join('');

  const skills = SKILLS.map((s) => {
    const b = skillBonus(char, s.id, reg);
    const prof = char.proficiency.skills.includes(s.id) ? '●' : '';
    const exp = char.proficiency.expertise.includes(s.id) ? '◆' : '';
    return `<tr><td>${s.name} (${s.ability})</td><td>${fmt(b)} ${prof}${exp}</td></tr>`;
  }).join('');

  const spells = known
    .sort((a, b) => (a!.level - b!.level) || a!.name.localeCompare(b!.name))
    .map((s) => `<tr><td>${esc(s!.name)}${s!.ritual ? ' 🕯' : ''}${s!.concentration ? ' ◉' : ''}</td><td>${s!.level === 0 ? 'trucchetto' : s!.level + '°'}</td><td>${esc(s!.school)}</td><td>${esc(s!.castingTime)}</td><td>${esc(s!.range)}</td><td>${esc(s!.duration)}</td></tr>`)
    .join('');

  const items = char.inventory.map((i) => `<tr><td>${esc(i.name)}${i.equipped ? ' (equip)' : ''}${i.magic ? ' ✨' : ''}</td><td>${i.quantity}</td><td>${i.weight * i.quantity}</td></tr>`).join('');

  const journal = (char.journal ?? []).slice(-30).reverse()
    .map((j) => `<tr><td class="muted">${new Date(j.at).toLocaleString('it-IT')}</td><td>${esc(j.text)}</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${esc(char.name)} — scheda</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; color: #111; max-width: 800px; margin: 16px auto; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 14px 0 4px; border-bottom: 1px solid #999; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #bbb; padding: 2px 6px; text-align: left; }
  .mod { color: #555; }
  .muted { color: #666; font-size: 11px; }
  .tags span { display: inline-block; border: 1px solid #999; border-radius: 10px; padding: 0 8px; margin: 0 3px 2px 0; font-size: 12px; }
  @media print { body { margin: 0; } }
</style></head><body>
<h1>${esc(char.name)}</h1>
<div class="muted">${esc(race?.name ?? char.raceId)} · ${esc(classes)} · Livello ${level} · XP ${char.xp}${char.background ? ' · ' + esc(char.background) : ''}${char.alignment ? ' · ' + esc(char.alignment) : ''}</div>
<div class="tags" style="margin:6px 0">
  <span>PF ${char.hp.current}/${hpMax}${char.hp.temp > 0 ? ` (+${char.hp.temp})` : ''}</span>
  <span>CA ${ac}</span>
  <span>Velocità ${speedOf(char, reg)}</span>
  <span>Percezione passiva ${passivePerception(char)}</span>
  <span>Bonus proficiency ${fmt(pb)}</span>
  <span>Inspirazione ${char.inspiration ? '★' : '—'}</span>
  <span>Esaurimento ${char.exhaustion ?? 0}</span>
  ${spellInfo.map((si) => `<span>🔮 ${esc(reg.classes.get(si.classId)?.name ?? si.classId)}: attacco ${fmt(si.attackBonus)}, CD ${si.saveDC}</span>`).join('')}
  ${char.concentrationSpellId ? `<span>◉ concentrazione: ${esc(reg.spells.get(char.concentrationSpellId)?.name ?? '')}</span>` : ''}
</div>
<h2>Caratteristiche</h2>
<table><tr>${abilities}</tr></table>
<h2>Tiri salvezza</h2>
<table>${saves}</table>
<h2>Abilità</h2>
<table>${skills}</table>
${known.length > 0 ? `<h2>Incantesimi conosciuti (${known.length})${prepared.length ? ` — preparati: ${esc(prepared.join(', '))}` : ''}</h2>
<table><tr><th>Nome</th><th>Liv</th><th>Scuola</th><th>Tempo</th><th>Portata</th><th>Durata</th></tr>${spells}</table>` : ''}
<h2>Inventario (${char.inventory.length}) — peso totale ${char.inventory.reduce((s, i) => s + i.weight * i.quantity, 0)}</h2>
<table><tr><th>Oggetto</th><th>Qtà</th><th>Peso</th></tr>${items}</table>
<div class="muted">Valuta: ${char.currency.gp} mo, ${char.currency.sp} ma, ${char.currency.ep} me, ${char.currency.cp} mr, ${char.currency.pp} mp</div>
${char.feats.length ? `<h2>Talenti</h2><div>${char.feats.map((f) => esc(reg.feats.get(f)?.name ?? f)).join(', ')}</div>` : ''}
${char.conditions.length ? `<h2>Condizioni</h2><div>${char.conditions.join(', ')}</div>` : ''}
${char.notes ? `<h2>Note</h2><p>${esc(char.notes)}</p>` : ''}
${journal ? `<h2>Diario di sessione</h2><table>${journal}</table>` : ''}
</body></html>`;
}

/** apre una finestra con la scheda formattata e lancia la stampa (salva come PDF) */
export function printSheet(char: Character, reg: Registry): void {
  const w = window.open('', '_blank', 'width=900,height=1200');
  if (!w) {
    alert('Pop-up bloccato: consenti i pop-up per esportare il PDF');
    return;
  }
  w.document.write(buildSheetHtml(char, reg));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
