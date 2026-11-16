import { useEffect, useRef, useState } from 'react';
import { CONDITIONS, type Character, type CombatState } from '@dnd5e/core';
import { NetClient, defaultWsUrl } from './net.js';
import { useStore } from './store.js';

interface PlayerInfo {
  id: string;
  name: string;
  role: 'master' | 'player';
  characterId?: string;
}

interface CampaignT {
  id: string;
  name: string;
  players: PlayerInfo[];
  characters: Record<string, Character>;
  combat: CombatState | null;
}

type ConnState =
  | { phase: 'offline' }
  | { phase: 'connecting'; error?: string }
  | { phase: 'online'; campaign: CampaignT; you: PlayerInfo };

export default function CampaignTab() {
  const { reg, char, setChar } = useStore();
  const [conn, setConn] = useState<ConnState>({ phase: 'offline' });
  const [url, setUrl] = useState(defaultWsUrl());
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [campaignList, setCampaignList] = useState<{ id: string; name: string; players: number }[]>([]);
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [error, setError] = useState('');
  const [targetId, setTargetId] = useState('');
  const [enemyId, setEnemyId] = useState('');
  const [moveAmt, setMoveAmt] = useState(6);
  const netRef = useRef<NetClient | null>(null);

  const send = (m: unknown) => netRef.current?.send(m);
  const act = (action: unknown) => send({ t: 'action', action });

  useEffect(() => {
    return () => netRef.current?.close();
  }, []);

  const connect = async () => {
    setError('');
    setConn({ phase: 'connecting' });
    const net = new NetClient();
    netRef.current = net;
    net.onMessage((m) => {
      if (m.t === 'welcome') setConn({ phase: 'online', campaign: m.campaign, you: m.you });
      else if (m.t === 'state') setConn((c) => (c.phase === 'online' ? { ...c, campaign: m.campaign } : c));
      else if (m.t === 'campaigns') setCampaignList(m.list);
      else if (m.t === 'error') setError(m.message);
      else if (m.t === 'closed') setConn({ phase: 'offline' });
    });
    try {
      await net.connect(url);
      if (mode === 'create') net.send({ t: 'create', name: name || 'Giocatore', password, campaignName: campaignName || 'Nuova campagna' });
      else net.send({ t: 'join', campaignId: joinId, password, name: name || 'Giocatore' });
    } catch (e) {
      setError((e as Error).message);
      setConn({ phase: 'offline' });
    }
  };

  const listCampaigns = () => {
    setError('');
    const net = netRef.current ?? new NetClient();
    if (!netRef.current) {
      netRef.current = net;
      net.onMessage((m) => {
        if (m.t === 'campaigns') setCampaignList(m.list);
        if (m.t === 'error') setError(m.message);
      });
      net.connect(url).catch((e) => setError((e as Error).message));
    }
    net.send({ t: 'list' });
  };

  const useMySheet = () => {
    if (char) act({ kind: 'setCharacter', character: char });
  };

  if (conn.phase !== 'online') {
    return (
      <div className="card" style={{ maxWidth: 520 }}>
        <h3>🌐 Campagna multiplayer</h3>
        <div className="row" style={{ marginBottom: 8 }}>
          <button className={mode === 'create' ? 'primary' : ''} onClick={() => setMode('create')}>Crea campagna (master)</button>
          <button className={mode === 'join' ? 'primary' : ''} onClick={() => setMode('join')}>Unisciti a una campagna</button>
        </div>
        <label>Server WebSocket</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ws://localhost:3001" />
        <label>Il tuo nome</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Eroe" />
        {mode === 'create' && (
          <>
            <label>Nome campagna</label>
            <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="La tomba perduta" />
          </>
        )}
        {mode === 'join' && (
          <>
            <div className="row" style={{ marginTop: 6 }}>
              <button onClick={listCampaigns}>📋 Elenca campagne sul server</button>
            </div>
            {campaignList.length > 0 && (
              <select value={joinId} onChange={(e) => setJoinId(e.target.value)} style={{ marginTop: 6 }}>
                <option value="">— scegli campagna —</option>
                {campaignList.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id}, {c.players} giocatori)</option>)}
              </select>
            )}
            <label style={{ marginTop: 6 }}>ID campagna (se non in lista)</label>
            <input value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="id a 8 caratteri" />
          </>
        )}
        <label>Password campagna</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <div style={{ marginTop: 10 }}>
          <button className="primary" disabled={conn.phase === 'connecting'} onClick={connect}>
            {conn.phase === 'connecting' ? 'Connessione...' : mode === 'create' ? 'Crea e entra' : 'Entra'}
          </button>
        </div>
        <div className="muted" style={{ marginTop: 10 }}>
          Avvia il server con <code>npm run server</code> (porta 3001): serve la web app e il WebSocket. In modalità "Crea" diventi il master.
        </div>
      </div>
    );
  }

  const { campaign, you } = conn;
  const combat = campaign.combat;
  const cur = combat?.combatants[combat.turnIndex];
  const myCharId = char?.id;
  const isMyTurn = !!(combat && cur && cur.isPlayer && cur.id === myCharId);
  const isMaster = you.role === 'master';
  const myCombatant = combat?.combatants.find((c) => c.id === myCharId);

  return (
    <div className="grid">
      <div className="card">
        <h3>🌐 {campaign.name} <span className="tag custom">{you.role === 'master' ? 'Master' : 'Giocatore'}</span> <span className="muted">id {campaign.id}</span></h3>
        <div className="row">
          <b>Giocatori:</b>
          {campaign.players.map((p) => (
            <span key={p.id} className={`tag ${p.id === you.id ? 'custom' : ''}`}>
              {p.name}{p.role === 'master' ? ' 👑' : ''}{campaign.characters[p.id] ? ` — ${campaign.characters[p.id].name}` : ' (senza scheda)'}
            </span>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={useMySheet} disabled={!char}>
            📤 {char ? `Carica la mia scheda (${char.name})` : 'Crea prima un personaggio in locale'}
          </button>
          <button onClick={() => { netRef.current?.close(); setConn({ phase: 'offline' }); }}>Esci</button>
        </div>
        {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
      </div>

      {isMaster && !combat && (
        <div className="card">
          <h3>👑 Pannello master</h3>
          <div className="row">
            <button className="primary" onClick={() => act({ kind: 'startCombat' })} disabled={Object.keys(campaign.characters).length === 0}>
              ⚔️ Avvia combattimento
            </button>
            <button onClick={() => act({ kind: 'rollInitiative' })} disabled={!combat}>🎲 Rilancia initiative</button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>I giocatori devono aver caricato la scheda. Il combattimento parte con tutti i PG.</div>
        </div>
      )}

      {combat && (
        <div className="card">
          <h3>⚔️ Combattimento — Round {combat.round} {cur && <span className="tag custom"> turno: {cur.name}</span>}</h3>
          <div className="row" style={{ marginBottom: 8 }}>
            {isMaster && (
              <>
                <select value={enemyId} onChange={(e) => setEnemyId(e.target.value)} style={{ width: 140 }}>
                  <option value="">+ nemico...</option>
                  {[...reg.enemies.values()].map((e) => <option key={e.id} value={e.id}>{e.name} (CA {e.ac}, {e.hp} PF)</option>)}
                </select>
                <button disabled={!enemyId} onClick={() => { act({ kind: 'addEnemy', enemyId, count: 1 }); setEnemyId(''); }}>Aggiungi</button>
                <button onClick={() => act({ kind: 'rollInitiative' })}>🎲 Initiative</button>
                <button className="danger" onClick={() => act({ kind: 'endCombat' })}>Fine combattimento</button>
              </>
            )}
            {(isMyTurn || isMaster) && (
              <button className="primary" onClick={() => act({ kind: 'nextTurn' })}>Turno ▶</button>
            )}
          </div>

          <table>
            <thead>
              <tr><th>Init</th><th>Combattente</th><th>PF</th><th>CA</th><th>Condizioni</th><th>Economia</th><th>Azioni</th></tr>
            </thead>
            <tbody>
              {combat.combatants.map((c, i) => (
                <tr key={c.id} style={i === combat.turnIndex ? { background: 'var(--panel2)' } : undefined}>
                  <td><b>{c.initiative}</b></td>
                  <td>{c.name} {c.isPlayer && <span className="tag">PG</span>}</td>
                  <td>{c.hp}/{c.maxHp}</td>
                  <td>{c.ac}</td>
                  <td>{c.conditions.map((cd) => <span key={cd} className="tag custom">{CONDITIONS.find((x) => x.id === cd)?.name ?? cd}{c.conditionRounds[cd] ? ` (${c.conditionRounds[cd]})` : ''}</span>)}</td>
                  <td className="muted" style={{ fontSize: 11 }}>
                    {c.actionUsed ? '❌azione' : '✅azione'} · {c.bonusUsed ? '❌bonus' : '✅bonus'} · {c.reactionUsed ? '❌reazione' : '✅reazione'} · 🏃{c.movement}
                  </td>
                  <td>
                    {(isMyTurn || isMaster) && cur?.id === c.id && (
                      <span className="row">
                        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ width: 110 }}>
                          <option value="">bersaglio...</option>
                          {combat.combatants.filter((t) => t.id !== c.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        {c.attacks.map((a, ai) => (
                          <button key={ai} disabled={!targetId || c.actionUsed} title={`${a.name}: +${a.bonus}, ${a.dice}`}
                            onClick={() => act({ kind: 'attack', targetId, attackIndex: ai })}>
                            🗡️ {a.name}
                          </button>
                        ))}
                        <input type="number" value={moveAmt} onChange={(e) => setMoveAmt(Number(e.target.value))} style={{ width: 60 }} />
                        <button disabled={c.movement <= 0} onClick={() => act({ kind: 'move', amount: moveAmt })}>🏃</button>
                        <button disabled={c.bonusUsed} onClick={() => act({ kind: 'useBonus' })}>⚡bonus</button>
                        <button disabled={c.reactionUsed} onClick={() => act({ kind: 'useReaction' })}>🛡️reazione</button>
                      </span>
                    )}
                    {isMaster && (
                      <span className="row">
                        <button className="danger" onClick={() => act({ kind: 'damage', targetId: c.id, amount: 5 })}>-5</button>
                        <button onClick={() => act({ kind: 'heal', targetId: c.id, amount: 5 })}>+5</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isMaster && (
            <div className="row" style={{ marginTop: 8 }}>
              <select value="" onChange={(e) => { if (e.target.value && cur) act({ kind: 'setCondition', targetId: cur.id, conditionId: e.target.value, on: true, rounds: 2 }); }} style={{ width: 160 }}>
                <option value="">+ condizione al turno corrente...</option>
                {CONDITIONS.map((cd) => <option key={cd.id} value={cd.id}>{cd.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {combat && (
        <div className="card">
          <h3>📜 Log</h3>
          <div style={{ maxHeight: 220, overflow: 'auto', fontSize: 12 }}>
            {[...combat.log].reverse().slice(0, 30).map((l, i) => <div key={i} className="muted">{l}</div>)}
          </div>
        </div>
      )}

      {!combat && !isMaster && (
        <div className="card"><h3>⏳ In attesa...</h3><div className="muted">Il master avvierà il combattimento. Assicurati di aver caricato la tua scheda.</div></div>
      )}
    </div>
  );
}
