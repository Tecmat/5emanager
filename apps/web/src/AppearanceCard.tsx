import { useStore } from './store.js';
import Icon from './icons.js';
import { MAIN_PAGES, SHEET_TABS } from './tabs.js';
import {
  PALETTES,
  moveId,
  orderTabs,
  resolvedTheme,
  updateUISettings,
  useUISettings,
  type BorderStyle,
  type IconSet,
  type ThemePref,
} from './uiSettings.js';

/**
 * Card "Personalizza interfaccia" (Home): tema chiaro/scuro/auto, palette colori
 * (predefinite o personalizzate), stile bordi e raggio angoli, set di icone e
 * ordinamento/visibilità delle tab principali e delle tab della scheda.
 */
export default function AppearanceCard() {
  const { t } = useStore();
  const ui = useUISettings();

  // lista completa (anche le nascoste) per poterle riordinare e ri-mostrare
  const allMain = orderTabs(MAIN_PAGES, ui.mainTabOrder, []);
  const allSheet = orderTabs(SHEET_TABS, ui.sheetTabOrder, []);

  const toggleHidden = (kind: 'main' | 'sheet', id: string) => {
    const hiddenKey = kind === 'main' ? 'mainTabHidden' : 'sheetTabHidden';
    const all = kind === 'main' ? MAIN_PAGES : SHEET_TABS;
    const hidden = ui[hiddenKey];
    const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
    // almeno una tab visibile per gruppo
    if (next.length >= all.length) return;
    updateUISettings({ [hiddenKey]: next });
  };

  const move = (kind: 'main' | 'sheet', id: string, dir: -1 | 1) => {
    const orderKey = kind === 'main' ? 'mainTabOrder' : 'sheetTabOrder';
    updateUISettings({ [orderKey]: moveId(ui[orderKey], id, dir) });
  };

  const TabRow = ({ kind, tab, icon, label, first, last }: { kind: 'main' | 'sheet'; tab: string; icon: React.ReactNode; label: string; first: boolean; last: boolean }) => {
    const hiddenKey = kind === 'main' ? 'mainTabHidden' : 'sheetTabHidden';
    const hidden = ui[hiddenKey].includes(tab);
    return (
      <div className="row" style={{ justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)', opacity: hidden ? 0.45 : 1 }}>
        <span className="row" style={{ gap: 6 }}>
          <button onClick={() => move(kind, tab, -1)} disabled={first} title={t('ui.tabUp', 'Sposta su')} aria-label={t('ui.tabUp', 'Sposta su')}>↑</button>
          <button onClick={() => move(kind, tab, 1)} disabled={last} title={t('ui.tabDown', 'Sposta giù')} aria-label={t('ui.tabDown', 'Sposta giù')}>↓</button>
          <span>{icon} <b>{label}</b></span>
        </span>
        <label className="row" style={{ margin: 0, gap: 4 }} title={t('ui.tabVis', 'Mostra/nascondi questa tab')}>
          <input type="checkbox" checked={!hidden} onChange={() => toggleHidden(kind, tab)} style={{ width: 'auto' }} /> 👁
        </label>
      </div>
    );
  };

  return (
    <div className="card">
      <h3 className="home-h"><Icon name="pencil" size={15} /> {t('ui.title', 'Personalizza interfaccia')}</h3>

      <div className="grid cols2">
        <div>
          <label>{t('ui.theme', 'Tema')}</label>
          <select value={ui.theme} onChange={(e) => updateUISettings({ theme: e.target.value as ThemePref })}>
            <option value="auto">{t('ui.themeAuto', 'Automatico (sistema)')}</option>
            <option value="dark">{t('ui.themeDark', 'Scuro')}</option>
            <option value="light">{t('ui.themeLight', 'Chiaro')}</option>
          </select>
        </div>
        <div>
          <label>{t('ui.icons', 'Set di icone')}</label>
          <select value={ui.iconSet} onChange={(e) => updateUISettings({ iconSet: e.target.value as IconSet })}>
            <option value="classic">{t('ui.iconsClassic', 'Classiche (interne)')}</option>
            <option value="lucide">{t('ui.iconsLucide', 'Lucide (open source)')}</option>
          </select>
        </div>
        <div>
          <label>{t('ui.border', 'Stile bordi')}</label>
          <select value={ui.border} onChange={(e) => updateUISettings({ border: e.target.value as BorderStyle })}>
            <option value="soft">{t('ui.borderSoft', 'Morbido (arrotondato)')}</option>
            <option value="sharp">{t('ui.borderSharp', 'Squadrato')}</option>
            <option value="pill">{t('ui.borderPill', 'Pill (pulsanti a capsula)')}</option>
          </select>
        </div>
        <div>
          <label>{t('ui.radius', 'Raggio angoli')}: {ui.border === 'sharp' ? 2 : ui.radius}px</label>
          <input
            type="range" min={0} max={20} value={ui.border === 'sharp' ? 2 : ui.radius}
            disabled={ui.border === 'sharp'}
            onChange={(e) => updateUISettings({ radius: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <label style={{ marginTop: 10 }}>{t('ui.palette', 'Palette colori')}</label>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {PALETTES.map((p) => (
          <button
            key={p.id}
            onClick={() => updateUISettings({ paletteId: p.id })}
            title={t(p.nameKey, p.nameFb)}
            aria-label={t(p.nameKey, p.nameFb)}
            style={{
              width: 34, height: 24, padding: 0, borderRadius: 6,
              background: `linear-gradient(135deg, ${p.dark.accent}, ${p.dark.accent2})`,
              border: ui.paletteId === p.id ? '2px solid var(--text)' : '1px solid var(--border)',
            }}
          />
        ))}
        <span className="row" style={{ gap: 4, marginLeft: 6 }} title={t('ui.customColors', 'Colori personalizzati (tema scuro; in chiaro vengono scuriti automaticamente)')}>
          <input type="color" value={ui.accent} onChange={(e) => updateUISettings({ paletteId: 'custom', accent: e.target.value })} style={{ width: 40, height: 28, padding: 0 }} aria-label={t('ui.accent', 'Colore principale')} />
          <input type="color" value={ui.accent2} onChange={(e) => updateUISettings({ paletteId: 'custom', accent2: e.target.value })} style={{ width: 40, height: 28, padding: 0 }} aria-label={t('ui.accent2', 'Colore secondario')} />
          {ui.paletteId === 'custom' && <span className="tag custom">{t('ui.custom', 'personalizzata')}</span>}
        </span>
      </div>
      <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>
        {t('ui.preview', 'Anteprima:')} <Icon name="home" size={14} /> <Icon name="swords" size={14} /> <Icon name="dice" size={14} /> <button className="primary" style={{ padding: '2px 10px' }}>{t('ui.btn', 'Prova')}</button> <span className="tag custom"><Icon name="check" size={11} /> tag</span>
        {' '}· {t('ui.themeNow', 'tema attuale')}: {resolvedTheme(ui) === 'light' ? t('ui.themeLight', 'Chiaro') : t('ui.themeDark', 'Scuro')}
      </div>

      <div className="grid cols2" style={{ marginTop: 10 }}>
        <div>
          <label>{t('ui.mainTabs', 'Tab principali (ordine e visibilità)')}</label>
          {allMain.map((p, i) => (
            <TabRow key={p.id} kind="main" tab={p.id} icon={<Icon name={p.icon} size={14} />} label={t(p.key, p.fb)} first={i === 0} last={i === allMain.length - 1} />
          ))}
        </div>
        <div>
          <label>{t('ui.sheetTabs', 'Tab della scheda (ordine e visibilità)')}</label>
          {allSheet.map((p, i) => (
            <TabRow key={p.id} kind="sheet" tab={p.id} icon={<Icon name={p.icon} size={14} />} label={t(p.key, p.fb)} first={i === 0} last={i === allSheet.length - 1} />
          ))}
        </div>
      </div>
    </div>
  );
}
