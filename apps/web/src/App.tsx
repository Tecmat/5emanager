import { useState } from 'react';
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
  const { char } = useStore();
  const [tab, setTab] = useState<Tab>('panoramica');
  const [theme, setTheme] = useState(localStorage.getItem('dnd5e-theme') ?? 'dark');

  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    setTheme(t);
    localStorage.setItem('dnd5e-theme', t);
    document.documentElement.dataset.theme = t;
  };

  if (!char) return <CreateForm />;

  return (
    <>
      <header className="top">
        <h1>⚔️ D&D 5e — {char.name}</h1>
        <span className="row">
          <span className="muted">Gestore schede</span>
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
