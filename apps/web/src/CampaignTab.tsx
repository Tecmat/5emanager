import { useState } from 'react';
import { ABILITIES, CONDITIONS, armorClass, maxHp, passiveInsight, passivePerception, totalLevel } from '@dnd5e/core';
import { useStore } from './store.js';
import { useNet } from './netStore.js';

export default function CampaignTab() {
  const { reg, char, sheets } = useStore();
  const {
    conn, auth, error, setError, pingState, campaignList,
    url, setUrl, name, setName, servers, savedCampaigns,
    act, connect, disconnect, checkConnection, refreshCampaignList,
    doRegister, doLogin, logout,
  } = useNet();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [password, setPassword] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [asMaster, setAsMaster] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountPw, setAccountPw] = useState('');
  const [localPick, setLocalPick] = useState('');
  const [accPick, setAccPick] = useState('');
  const [targetId, setTargetId] = useState('');
  const [enemyId, setEnemyId] = useState('');
  const [moveAmt, setMoveAmt] = useState(6);

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
                <button onClick={logout}>Esci dall'account</button>
              </div>
            </>
          ) : (
            <>
              <div className="row">
                <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Username" style={{ flex: 1 }} />
                <input type="password" value={accountPw} onChange={(e) => setAccountPw(e.target.value)} placeholder="Password" style={{ flex: 1 }} />
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={() => doRegister(accountName, accountPw)}>Registrati</button>
                <button className="primary" onClick={() => doLogin(accountName, accountPw)}>Login</button>
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
              <label className="row" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={asMaster} onChange={(e) => setAsMaster(e.target.checked)} style={{ width: 'auto' }} />
                <span>Entra come <b>master</b> (serve la password della campagna; possibile solo se nessun master è collegato)</span>
              </label>
            </>
          )}
          <label>Password campagna</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="error">{error}</div>}
          <div style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={conn.phase === 'connecting'}
              onClick={() => { setError(''); connect({ mode, password, campaignName, joinId, asMaster }); }}
            >
              {conn.phase === 'connecting' ? 'Connessione...' : mode === 'create' ? 'Crea e entra' : 'Entra'}
            </button>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Avvia il server con <code>npm run server</code> (porta 3001): serve la web app e il WebSocket.
            Pannello admin del server: <code>/admin</code>. In modalità "Crea" diventi il master.
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
          <button onClick={disconnect}>Esci</button>
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
        {!auth && <div className="muted" style={{ marginTop: 6 }}>La connessione resta attiva anche cambiando tab. Esci e fai login dall'account per salvare le schede sul server e riutilizzarle in altre campagne.</div>}
      </div>

      {isMaster && (
        <div className="card">
          <h3>🖥 Schermo del master</h3>
          <table>
            <thead>
              <tr><th>Giocatore</th><th>PG</th><th>Liv</th><th>PF</th><th>CA</th><th>Percez. passiva</th><th>Intuizione passiva</th><th>Condizioni</th></tr>
            </thead>
            <tbody>
              {campaign.players.map((p) => {
                const ch = campaign.characters[p.id];
                if (!ch) return <tr key={p.id}><td>{p.name}</td><td className="muted" colSpan={7}>senza scheda</td></tr>;
                return (
                  <tr key={p.id}>
                    <td>{p.name}{p.role === 'master' ? ' 👑' : ''}</td>
                    <td>{ch.name}</td>
                    <td>{totalLevel(ch)}</td>
                    <td>{ch.hp.current}/{maxHp(ch, reg)}</td>
                    <td>{armorClass(ch, reg).ac}</td>
                    <td>{passivePerception(ch)}</td>
                    <td>{passiveInsight(ch)}</td>
                    <td>{ch.conditions.map((cd) => <span key={cd} className="tag custom">{CONDITIONS.find((x) => x.id === cd)?.name ?? cd}</span>)}{ch.exhaustion > 0 && <span className="tag custom">esaurimento {ch.exhaustion}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isMaster && (
        <div className="card">
          <h3>👑 Pannello master — schede e status dei giocatori</h3>
          {campaign.players.length === 0 && <div className="muted">Nessun giocatore collegato.</div>}
          {campaign.players.map((p) => {
            const ch = campaign.characters[p.id];
            return (
              <details key={p.id} style={{ marginBottom: 6 }}>
                <summary style={{ cursor: 'pointer' }}>
                  <b>{p.name}</b> {p.role === 'master' ? '👑' : ''}
                  {ch ? (
                    <span className="row" style={{ display: 'inline-flex', marginLeft: 8 }}>
                      <span className="tag custom">{ch.name} — liv {totalLevel(ch)}</span>
                      <span className="tag">PF {ch.hp.current}/{maxHp(ch, reg)}</span>
                      <span className="tag">CA {armorClass(ch, reg).ac}</span>
                      <span className="tag">XP {ch.xp}</span>
                      {ch.conditions.map((cd) => <span key={cd} className="tag custom">{CONDITIONS.find((x) => x.id === cd)?.name ?? cd}</span>)}
                    </span>
                  ) : <span className="muted"> (senza scheda)</span>}
                </summary>
                {ch && (
                  <div style={{ marginTop: 6 }}>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <button className="danger" onClick={() => act({ kind: 'masterDamage', playerId: p.id, amount: 5 })}>🔒 −5 PF</button>
                      <button onClick={() => act({ kind: 'masterHeal', playerId: p.id, amount: 5 })}>🔒 +5 PF</button>
                      <button onClick={() => act({ kind: 'masterAddXp', playerId: p.id, amount: 300 })}>🔒 +300 XP</button>
                      <select value="" onChange={(e) => { if (e.target.value) act({ kind: 'masterSetCondition', playerId: p.id, conditionId: e.target.value, on: true }); }}>
                        <option value="">🔒 + condizione…</option>
                        {CONDITIONS.map((cd) => <option key={cd.id} value={cd.id}>{cd.name}</option>)}
                      </select>
                      <select value="" onChange={(e) => { if (e.target.value) act({ kind: 'masterSetCondition', playerId: p.id, conditionId: e.target.value, on: false }); }}>
                        <option value="">🔒 − condizione…</option>
                        {ch.conditions.map((cd) => <option key={cd} value={cd}>{CONDITIONS.find((x) => x.id === cd)?.name ?? cd}</option>)}
                      </select>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Caratteristiche: {ABILITIES.map((ab) => `${ab.toUpperCase()} ${ch.abilityScores[ab]}`).join(' · ')}<br />
                      Incantesimi conosciuti: {ch.spellsKnown.length} · Oggetti: {ch.inventory.length} · Competenze: {ch.proficiency.skills.join(', ') || '—'}
                      {ch.notes ? <><br />Note: {ch.notes}</> : null}
                    </div>
                  </div>
                )}
              </details>
            );
          })}
          <div className="muted" style={{ marginTop: 4 }}>Le azioni 🔒 sono applicate di nascosto: non finiscono nel log pubblico del combattimento.</div>
        </div>
      )}

      {isMaster && !combat && (
        <div className="card">
          <h3>👑 Avvio combattimento</h3>
          <div className="row">
            <button className="primary" onClick={() => act({ kind: 'startCombat' })} disabled={Object.keys(campaign.characters).length === 0}>
              ⚔️ Avvia combattimento
            </button>
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
