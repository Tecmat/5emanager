import { useEffect, useState } from 'react';
import { totalLevel } from '@dnd5e/core';
import { useStore } from './store.js';
import CreateForm from './CreateForm.js';
import Overview from './Overview.js';
import SpellsTab from './SpellsTab.js';
import InventoryTab from './InventoryTab.js';
import CustomTab from './CustomTab.js';
import CombatTab from './CombatTab.js';
import CampaignTab from './CampaignTab.js';

type Tab = 'panoramica' | 'incantesimi' | 'inventario' | 'combattimento' | 'campagna' | 'custom';

export default function App() {
  const { char, sheets, selectSheet } = useStore();
  const [tab, setTab] = useState<Tab>('panoramica');
  const [theme, setTheme] = useState(localStorage.getItem('dnd5e-theme') ?? 'dark');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (char) setCreating(false);
  }, [char]);

  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    setTheme(t);
    localStorage.setItem('dnd5e-theme', t);
    document.documentElement.dataset.theme = t;
  };

  if (!char || creating) {
    return <CreateForm onCancel={char ? () => setCreating(false) : undefined} />;
  }

  return (
    <>
      <header className="top">
        <span className="row">
          {char.portrait && <img className="portrait" style={{ width: 36, height: 36 }} src={char.portrait} alt={char.name} />}
          <h1>⚔️ D&D 5e — {char.name}</h1>
          {sheets.length > 1 && (
            <select
              value={char.id}
              onChange={(e) => selectSheet(e.target.value)}
              title="Cambia scheda personaggio"
              style={{ maxWidth: 180 }}
            >
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>{s.name} (liv {totalLevel(s)})</option>
              ))}
            </select>
          )}
          <button onClick={() => setCreating(true)} title="Crea un nuovo personaggio">＋ Nuovo</button>
        </span>
        <span className="row">
          <span className="muted">Gestore schede{sheets.length > 1 ? ` · ${sheets.length} schede` : ''}</span>
          <button onClick={toggleTheme} title="Cambia tema">{theme === 'dark' ? '🌙' : '☀️'}</button>
        </span>
      </header>
      <main>
        <nav className="tabs">
          {(
            [
              ['panoramica', 'Panoramica'],
              ['incantesimi', 'Incantesimi'],
              ['inventario', 'Inventario'],
              ['combattimento', '⚔️ Combattimento'],
              ['campagna', '🌐 Campagna'],
              ['custom', 'Contenuti custom'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        {tab === 'panoramica' && <Overview />}
        {tab === 'incantesimi' && <SpellsTab />}
        {tab === 'inventario' && <InventoryTab />}
        {tab === 'combattimento' && <CombatTab />}
        {tab === 'campagna' && <CampaignTab />}
        {tab === 'custom' && <CustomTab />}
      </main>
    </>
  );
}
