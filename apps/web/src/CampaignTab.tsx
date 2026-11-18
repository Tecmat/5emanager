import { useEffect, useRef, useState } from 'react';
import { CONDITIONS, totalLevel, type Character, type CombatState } from '@dnd5e/core';
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

interface AuthState {
  token: string;
  username: string;
  characters: Character[];
}

type PingState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; rtt: number }
  | { status: 'error'; message: string };

interface SavedCampaign {
  server: string;
  id: string;
  name: string;
}

const SERVERS_KEY = 'dnd5e.servers.v1';
const JOINED_KEY = 'dnd5e.joined.v1';
const ACCOUNT_KEY = 'dnd5e.account.v1';

function loadServers(): string[] {
  try { return JSON.parse(localStorage.getItem(SERVERS_KEY) ?? '[]') as string[]; } catch { return []; }
}

function loadJoined(): SavedCampaign[] {
  try { return JSON.parse(localStorage.getItem(JOINED_KEY) ?? '[]') as SavedCampaign[]; } catch { return []; }
}

/** hash SHA-256 usato SOLO lato client per la password dell'account */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('5e-' + s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function CampaignTab() {
  const { reg, char, sheets } = useStore();
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
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [lastUsername, setLastUsername] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountPw, setAccountPw] = useState('');
  const [pingState, setPingState] = useState<PingState>({ status: 'idle' });
  const [servers, setServers] = useState<string[]>(loadServers);
  const [savedCampaigns, setSavedCampaigns] = useState<SavedCampaign[]>(loadJoined);
  const [localPick, setLocalPick] = useState('');
  const [accPick, setAccPick] = useState('');

  const send = (m: unknown) => netRef.current?.send(m);
  const act = (action: unknown) => send({ t: 'action', action });

  useEffect(() => {
    return () => netRef.current?.close();
  }, []);

  const rememberServer = (u: string) => {
    setServers((prev) => {
      const next = [u, ...prev.filter((s) => s !== u)].slice(0, 8);
      try { localStorage.setItem(SERVERS_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  };

  const rememberJoined = (c: SavedCampaign) => {
    setSavedCampaigns((prev) => {
      const next = [c, ...prev.filter((x) => !(x.id === c.id && x.server === c.server))].slice(0, 20);
      try { localStorage.setItem(JOINED_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  };

  const attachHandlers = (net: NetClient, serverUrl: string) => {
    net.onMessage((m) => {
      if (m.t === 'welcome') {
        setConn({ phase: 'online', campaign: m.campaign, you: m.you });
        rememberJoined({ server: serverUrl, id: m.campaign.id, name: m.campaign.name });
      } else if (m.t === 'state') {
        setConn((c) => (c.phase === 'online' ? { ...c, campaign: m.campaign } : c));
      } else if (m.t === 'campaigns') {
        setCampaignList(m.list);
      } else if (m.t === 'auth') {
        setAuth({ token: m.token, username: m.username, characters: m.characters });
        setLastUsername(m.username);
      } else if (m.t === 'error') {
        setError(m.message);
      } else if (m.t === 'closed') {
        setConn({ phase: 'offline' });
      }
    });
  };

  const ensureNet = async (): Promise<NetClient> => {
    const cur = netRef.current;
    if (cur && cur.ws && cur.ws.readyState === WebSocket.OPEN) return cur;
    cur?.close();
    const net = new NetClient();
    netRef.current = net;
    attachHandlers(net, url);
    await net.connect(url);
    rememberServer(url);
    return net;
  };

  const checkConnection = async () => {
    setPingState({ status: 'checking' });
    try {
      const net = await ensureNet();
      const res = await net.ping();
      setPingState({ status: 'ok', rtt: Math.round(res.rtt) });
    } catch (e) {
      setPingState({ status: 'error', message: (e as Error).message });
    }
  };

  const refreshCampaignList = async () => {
    setError('');
    try {
      const net = await ensureNet();
      net.send({ t: 'list' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doRegister = async () => {
    setError('');
    const username = accountName.trim();
    if (!username) { setError('Inserisci uno username'); return; }
    try {
      const hash = await sha256Hex(accountPw);
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ username, hash }));
    } catch { /* crypto non disponibile: password solo in memoria */ }
    try {
      const net = await ensureNet();
      net.send({ t: 'register', username });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doLogin = async () => {
    setError('');
    const username = accountName.trim();
    if (!username) { setError('Inserisci lo username'); return; }
    // la password viene verificata SOLO lato client (per ora il server non la vede)
    try {
      const raw = localStorage.getItem(ACCOUNT_KEY);
      if (raw) {
        const rec = JSON.parse(raw) as { username: string; hash: string };
        if (rec.username.toLowerCase() === username.toLowerCase()) {
          const hash = await sha256Hex(accountPw);
          if (hash !== rec.hash) { setError('Password errata (controllo locale)'); return; }
        }
      }
    } catch { /* ignora */ }
    try {
      const net = await ensureNet();
      net.send({ t: 'login', username });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const connect = async () => {
    setError('');
    setConn({ phase: 'connecting' });
    try {
      const net = await ensureNet();
      if (lastUsername) net.send({ t: 'login', username: lastUsername });
      if (mode === 'create') net.send({ t: 'create', name: name || 'Giocatore', password, campaignName: campaignName || 'Nuova campagna' });
      else net.send({ t: 'join', campaignId: joinId, password, name: name || 'Giocatore' });
    } catch (e) {
      setError((e as Error).message);
      setConn({ phase: 'offline' });
    }
  };

  if (conn.phase !== 'online') {
    return (
      <div className="grid" style={{ maxWidth: 560 }}>
        <div className="card">
          <h3>🌐 Server</h3>
          <label>Server WebSocket</label>
          <div className="row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="ws://localhost:3001"
              style={{ flex: 1 }}
              list="saved-servers"
            />
            <datalist id="saved-servers">
              {servers.map((s) => <option key={s} value={s} />)}
            </datalist>
            <button onClick={checkConnection} disabled={pingState.status === 'checking'} title="Controllo manuale della connessione (puoi ripeterlo per aggiornare)">
              {pingState.status === 'checking' ? 'Ping…' : '🔌 Verifica connessione'}
            </button>
          </div>
          {pingState.status === 'ok' && <div className="ok" style={{ marginTop: 6 }}>✅ Connesso — ping {pingState.rtt} ms</div>}
          {pingState.status === 'error' && <div className="error" style={{ marginTop: 6 }}>❌ {pingState.message}</div>}
          {servers.length > 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted">Server salvati:</span>
              {servers.map((s) => (
                <button key={s} className="tag" style={{ cursor: 'pointer' }} onClick={() => setUrl(s)}>{s}</button>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3>👤 Account</h3>
          {auth ? (
            <>
              <div className="ok">✅ Loggato come <b>{auth.username}</b> — {auth.characters.length} scheda/e in libreria</div>
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={() => { setAuth(null); setLastUsername(''); setAccountName(''); setAccountPw(''); }}>Esci dall'account</button>
              </div>
            </>
          ) : (
            <>
              <div className="row">
                <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Username" style={{ flex: 1 }} />
                <input type="password" value={accountPw} onChange={(e) => setAccountPw(e.target.value)} placeholder="Password" style={{ flex: 1 }} />
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={doRegister}>Registrati</button>
                <button className="primary" onClick={doLogin}>Login</button>
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                Per ora la password resta solo su questo dispositivo (hash in localStorage): non viene inviata al server.
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h3>🎲 Campagna multiplayer</h3>
          <div className="row" style={{ marginBottom: 8 }}>
            <button className={mode === 'create' ? 'primary' : ''} onClick={() => setMode('create')}>Crea campagna (master)</button>
            <button className={mode === 'join' ? 'primary' : ''} onClick={() => setMode('join')}>Unisciti a una campagna</button>
          </div>
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
                <button onClick={refreshCampaignList}>📋 Aggiorna lista dal server</button>
              </div>
              {savedCampaigns.length > 0 && (
                <>
                  <label>Campagne salvate</label>
                  <select
                    value={joinId}
                    onChange={(e) => {
                      setJoinId(e.target.value);
                      const sc = savedCampaigns.find((x) => x.id === e.target.value);
                      if (sc && sc.server !== url) setUrl(sc.server);
                    }}
                  >
                    <option value="">— scegli una campagna salvata —</option>
                    {savedCampaigns.map((c) => <option key={c.server + c.id} value={c.id}>{c.name} ({c.id}) @ {c.server}</option>)}
                  </select>
                </>
              )}
              {campaignList.length > 0 && (
                <>
                  <label>Campagne sul server</label>
                  <select value={joinId} onChange={(e) => setJoinId(e.target.value)}>
                    <option value="">— scegli campagna —</option>
                    {campaignList.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id}, {c.players} giocatori)</option>)}
                  </select>
                </>
              )}
              <label>ID campagna (manuale)</label>
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
          <button onClick={checkConnection} disabled={pingState.status === 'checking'} title="Controllo manuale (ripetibile per aggiornare)">
            {pingState.status === 'checking' ? 'Ping…' : '🔌 Verifica connessione'}
          </button>
          {pingState.status === 'ok' && <span className="ok">✅ {pingState.rtt} ms</span>}
          {pingState.status === 'error' && <span className="error">❌ {pingState.message}</span>}
          <button onClick={() => { netRef.current?.close(); setConn({ phase: 'offline' }); }}>Esci</button>
        </div>
        {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
      </div>

      <div className="card">
        <h3>📤 Scegli la scheda da usare in campagna</h3>
        {sheets.length > 0 && (
          <div className="row">
            <select value={localPick || char?.id || ''} onChange={(e) => setLocalPick(e.target.value)}>
              {sheets.map((s) => <option key={s.id} value={s.id}>{s.name} (liv {totalLevel(s)})</option>)}
            </select>
            <button
              disabled={!localPick && !char}
              onClick={() => {
                const c = sheets.find((s) => s.id === (localPick || char?.id));
                if (c) act({ kind: 'setCharacter', character: c });
              }}
            >
              Carica scheda locale
            </button>
          </div>
        )}
        {auth && auth.characters.length > 0 && (
          <div className="row" style={{ marginTop: 6 }}>
            <select value={accPick} onChange={(e) => setAccPick(e.target.value)}>
              <option value="">— scheda dalla libreria di {auth.username} —</option>
              {auth.characters.map((c) => <option key={c.id} value={c.id}>{c.name} (liv {totalLevel(c)})</option>)}
            </select>
            <button disabled={!accPick} onClick={() => act({ kind: 'useCharacter', characterId: accPick })}>Carica da account</button>
          </div>
        )}
        {auth && char && (
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={() => act({ kind: 'saveCharacter', character: char })}>
              💾 Salva "{char.name}" nella libreria dell'account ({auth.username})
            </button>
          </div>
        )}
        {!auth && <div className="muted" style={{ marginTop: 6 }}>Esci e fai login dall'account per salvare le schede sul server e riutilizzarle in altre campagne.</div>}
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
