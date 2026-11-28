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
  const bgName = char.background ? (reg.backgrounds.get(char.background)?.name ?? char.background) : '';
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
  @page { margin: 12mm; }
  body { font: 12.5px/1.45 Georgia, 'Iowan Old Style', 'Times New Roman', serif; color: #2b2118; max-width: 780px; margin: 0 auto; background: #f8f1dd; padding: 18px 22px; }
  .sheet-head { border-bottom: 3px double #a8842c; padding-bottom: 8px; margin-bottom: 4px; overflow: hidden; }
  h1 { font-size: 27px; margin: 0; letter-spacing: 0.5px; color: #4a3510; }
  .sub { color: #6d5a33; font-size: 12.5px; margin-top: 3px; }
  .portrait { float: right; width: 96px; height: 96px; object-fit: cover; border: 2px solid #a8842c; border-radius: 8px; margin: 0 0 8px 12px; background: #fff; }
  h2 { font-size: 13px; margin: 15px 0 5px; color: #6b4f0e; text-transform: uppercase; letter-spacing: 0.09em; border-bottom: 1px solid #c9a94e; padding-bottom: 2px; page-break-after: avoid; }
  table { border-collapse: collapse; width: 100%; margin-top: 4px; }
  td, th { border: 1px solid #d8c48f; padding: 3px 7px; text-align: left; }
  th { background: #efe3bd; color: #5c470d; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; }
  tr { page-break-inside: avoid; }
  .abilities td { text-align: center; background: #fff8e1; font-size: 13px; }
  .mod { color: #8a6d1f; font-size: 11px; }
  .muted { color: #7a6a4a; font-size: 11px; }
  .stats { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0; }
  .stats span { display: inline-block; border: 1px solid #a8842c; background: #fff8e1; border-radius: 5px; padding: 2px 9px; font-size: 12px; font-weight: bold; color: #4a3510; }
  .footer { margin-top: 18px; padding-top: 6px; border-top: 1px solid #c9a94e; color: #7a6a4a; font-size: 10.5px; text-align: center; }
  @media print { body { background: #fff; padding: 0; max-width: none; margin: 0; } }
</style></head><body>
<div class="sheet-head">
  ${char.portrait ? `<img class="portrait" src="${char.portrait}" alt="ritratto">` : ''}
  <h1>${esc(char.name)}</h1>
  <div class="sub">${esc(race?.name ?? char.raceId)} · ${esc(classes)} · Livello ${level} · XP ${char.xp}${bgName ? ' · ' + esc(bgName) : ''}${char.alignment ? ' · ' + esc(char.alignment) : ''}</div>
</div>
<div class="stats">
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
<table class="abilities"><tr>${abilities}</tr></table>
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
<div class="footer">5e Manager · scheda di ${esc(char.name)} · generata il ${new Date().toLocaleString('it-IT')}</div>
</body></html>`;
}

/**
 * stampa la scheda formattata (dal dialog del browser: "Salva come PDF").
 * NIENTE window.open: i pop-up blocker lo bloccano e le WebView native
 * (Android APK / Tauri WebKitGTK) non lo supportano proprio — si usa un
 * iframe nascosto fuori schermo, che non viene mai bloccato.
 */
export function printSheet(char: Character, reg: Registry): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;height:1000px;border:0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument ?? win?.document;
  if (!win || !doc) {
    iframe.remove();
    alert('Stampa non disponibile in questo ambiente: usa Ctrl+P (o menu ⋮ → Stampa) sulla pagina della scheda');
    return;
  }
  doc.open();
  doc.write(buildSheetHtml(char, reg));
  doc.close();
  const cleanup = () => iframe.remove();
  win.addEventListener('afterprint', cleanup);
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
    // fallback di pulizia se afterprint non scatta (alcune WebView)
    window.setTimeout(cleanup, 120_000);
  }, 350);
}
