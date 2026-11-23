import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ABILITIES,
  CONDITIONS,
  SKILLS,
  armorClass,
  maxHp,
  passiveInsight,
  passivePerception,
  savingThrowBonus,
  skillBonus,
  speedOf,
  totalLevel,
  currencyToCopper,
  rollEncounter,
  rollTreasure,
  randomName,
  type Character,
  type Currency,
  type ItemRarity,
  type Campaign,
  type Registry,
  type TemplateShape,
} from '@dnd5e/core';
import { RANDOM_DATA } from '@dnd5e/data-srd';
import { useStore } from './store.js';
import { useNet, passkeySupported } from './netStore.js';
import { P2PClient, P2PDiscovery, P2PHost, P2PLanClient, P2PLanHost, P2PRelayClient, P2PRelayHost, webrtcSupported, newInviteCode, getP2PRejoinToken, CODE_PREFIX, type P2PHostInfo } from './p2p.js';
import { qrEncode, qrSvg, scanQr } from './qr.js';
import { onDeepLink, consumePendingDeepLink } from './deepLink.js';
import { detectPlatform, errMsg } from './update.js';
import { isLocalhostHost } from './net.js';
import { scanLanPeers, type LanPeer, type LanServer } from './lan.js';
import { LAN_BEACON_PORT, beaconStart, beaconSetCode, detectLocalIp, detectLocalIps, lanBeaconSupported } from './lanBeacon.js';
import { listSavedP2P, getSavedP2P, saveP2PCampaign, onResumeRequest, type SavedP2PCampaign } from './p2pSaved.js';
import Icon from './icons.js';
import { campaignSheetId, isCampaignSheetId } from './store.js';
import TemplateView from './TemplateView.js';

/** QR del testo (per condividere il codice invito) */
function QrBox({ text }: { text: string }) {
  const res = useMemo(() => qrEncode(text), [text]);
  if (!res) return <div className="error" style={{ fontSize: 11 }}>QR non generabile (codice troppo lungo)</div>;
  const scale = Math.max(1, Math.floor(160 / (res.size + 8)));
  return (
    <span
      style={{ display: 'inline-block', lineHeight: 0, background: '#fff', borderRadius: 6, padding: 4 }}
      dangerouslySetInnerHTML={{ __html: qrSvg(res, scale) }}
    />
  );
}

async function copyText(s: string): Promise<void> {
  try { await navigator.clipboard.writeText(s); return; } catch { /* fallback sotto */ }
  const ta = document.createElement('textarea');
  ta.value = s;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* ignora */ }
  ta.remove();
}

async function shareText(s: string): Promise<boolean> {
  const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
  if (nav.share) {
    try { await nav.share({ text: s }); return true; } catch { return false; }
  }
  return false;
}

/**
 * trova da solo il ws:// del server LAN: URL salvato (se non localhost) oppure l'origin della
 * pagina SOLO in web. Su app nativa (APK servita da https://localhost) ws://localhost non esiste:
 * si lascia vuoto e si usa la scansione della rete.
 */
function autoDiscWsUrl(): string {
  try {
    const saved = localStorage.getItem('dnd5e.net.url') ?? '';
    if (/^wss?:\/\/.+/.test(saved) && !isLocalhostHost(new URL(saved).host)) return saved;
    if (detectPlatform() === 'web' && /^https?:$/.test(location.protocol) && location.host) {
      return `ws://${location.host}`;
    }
    return '';
  } catch {
    return '';
  }
}

/** true se il server 5emanager all'URL risponde (sonda /api/info con timeout 2.5s) */
async function serverReachable(u: string): Promise<boolean> {
  try {
    const http = u.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/.*$/, '');
    const r = await fetch(`${http}/api/info`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** vista completa (sola lettura) della scheda di un giocatore, per il master */
function SheetFull({ ch, reg }: { ch: Character; reg: Registry }) {
  const { t } = useStore();
  const lvl = totalLevel(ch);
  const clsNames = ch.classLevels.map((cl) => `${reg.classes.get(cl.classId)?.name ?? cl.classId} ${cl.level}`).join(' / ');
  const slots = Object.entries(ch.spellSlots).filter(([, v]) => v.total > 0).sort((a, b) => Number(a[0]) - Number(b[0]));
  return (
    <div style={{ fontSize: 12, marginTop: 6 }}>
      <div className="row">
        {ch.portrait && <img className="portrait" src={ch.portrait} alt={ch.name} />}
        <div>
          <b>{ch.name}</b> — {reg.races.get(ch.raceId)?.name} · {clsNames} (liv {lvl}){ch.background ? ` · ${ch.background}` : ''}{ch.alignment ? ` · ${ch.alignment}` : ''}
          <div className="muted">
            {t('sf.hp','PF')} {ch.hp.current}/{maxHp(ch, reg)}{ch.hp.temp > 0 ? ` (+${ch.hp.temp})` : ''} · {t('sf.ac','CA')} {armorClass(ch, reg).ac} · {t('sf.vel','Vel')} {speedOf(ch, reg)} · {t('sf.xp','XP')} {ch.xp} · {t('sf.exh','Esaurimento')} {ch.exhaustion ?? 0}
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        {ABILITIES.map((ab) => (
          <span key={ab} className="tag">{ab.toUpperCase()} {ch.abilityScores[ab]} ({Math.floor((ch.abilityScores[ab] - 10) / 2) >= 0 ? '+' : ''}{Math.floor((ch.abilityScores[ab] - 10) / 2)})</span>
        ))}
      </div>
      <div style={{ marginTop: 4 }}>
        <b>{t('sf.ts', 'TS:')}</b> {ABILITIES.map((ab) => `${ab.toUpperCase()} ${savingThrowBonus(ch, ab, reg) >= 0 ? '+' : ''}${savingThrowBonus(ch, ab, reg)}`).join(' · ')}
        {' '}<b>{t('sf.passive', 'Passivi:')}</b> {t('sf.perc', 'Percezione')} {passivePerception(ch)} · {t('sf.ins', 'Intuizione')} {passiveInsight(ch)}
      </div>
      <div style={{ marginTop: 4 }}>
        <b>{t('sf.skills', 'Competenze:')}</b> {ch.proficiency.skills.length ? ch.proficiency.skills.map((s) => `${SKILLS.find((x) => x.id === s)?.name ?? s} ${skillBonus(ch, s, reg) >= 0 ? '+' : ''}${skillBonus(ch, s, reg)}`).join(', ') : '—'}
        {ch.proficiency.expertise.length > 0 && <> · {t('sf.expertise','expertise')}: {ch.proficiency.expertise.join(', ')}</>}
      </div>
      {slots.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <b>{t('sf.slots', 'Slot:')}</b> {slots.map(([l, v]) => `${l}° ${v.total - v.used}/${v.total}`).join(' · ')}
          {ch.concentrationSpellId && <> · {t('sf.conc', 'concentrazione:')} {reg.spells.get(ch.concentrationSpellId)?.name}</>}
        </div>
      )}
      {ch.spellsKnown.length > 0 && (
        <div style={{ marginTop: 4 }}><b>{t('sf.known', 'Incantesimi conosciuti:')}</b> {ch.spellsKnown.map((id) => reg.spells.get(id)?.name ?? id).join(', ')}</div>
      )}
      {ch.spellsPrepared.length > 0 && (
        <div style={{ marginTop: 4 }}><b>{t('sf.prepared', 'Preparati:')}</b> {ch.spellsPrepared.map((id) => reg.spells.get(id)?.name ?? id).join(', ')}</div>
      )}
      {ch.inventory.length > 0 && (
        <div style={{ marginTop: 4 }}><b>{t('sf.inv', 'Inventario:')}</b> {ch.inventory.map((i) => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ''}${i.equipped ? ' (equip)' : ''}`).join(', ')}</div>
      )}
      <div style={{ marginTop: 4 }}><b>{t('sf.currency', 'Valuta:')}</b> {ch.currency.gp} mo {ch.currency.sp} ma {ch.currency.ep} me {ch.currency.cp} mr {ch.currency.pp} mp</div>
      {ch.feats.length > 0 && <div style={{ marginTop: 4 }}><b>{t('sf.feats', 'Talenti:')}</b> {ch.feats.map((f) => reg.feats.get(f)?.name ?? f).join(', ')}</div>}
      {ch.conditions.length > 0 && <div style={{ marginTop: 4 }}><b>{t('sf.cond', 'Condizioni:')}</b> {ch.conditions.map((cd) => CONDITIONS.find((x) => x.id === cd)?.name ?? cd).join(', ')}</div>}
      {ch.notes && <div style={{ marginTop: 4 }}><b>{t('sf.notes', 'Note:')}</b> {ch.notes}</div>}
    </div>
  );
}

export default function CampaignTab() {
  const { reg, char, sheets, viewChar, viewLabel, setViewChar, t, tf, getCampaignSheet, setCampaignSheet, setCampaignMeta, selectSheet, campaignMeta } = useStore();
  const {
    conn, auth, error, setError, notice, pingState, campaignList,
    url, setUrl, name, setName, servers, savedCampaigns,
    act, connect, disconnect, checkConnection, refreshCampaignList,
    doRegister, doLogin, logout, setConn, handleNetMessage, setP2PTransport,
    totpPending, totpSetup, doLoginTotp, doLoginTotpBackup, setupTotp, enableTotp, disableTotp,
    passkeys, passkeyLogin, passkeyRegister, refreshPasskeys, removePasskey,
  } = useNet();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [chatText, setChatText] = useState('');
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem('dnd5e.turnSound') !== 'off'; } catch { return true; }
  });
  /** beep breve (WebAudio, niente asset) quando inizia il tuo turno */
  const turnBeep = () => {
    try {
      if (localStorage.getItem('dnd5e.turnSound') === 'off') return;
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.18);
      window.setTimeout(() => { void ctx.close().catch(() => {}); }, 400);
    } catch { /* audio non disponibile */ }
  };
  const toggleSound = () => {
    setSoundOn((v) => {
      const next = !v;
      try { localStorage.setItem('dnd5e.turnSound', next ? 'on' : 'off'); } catch { /* quota */ }
      return next;
    });
  };
  const [netMode, setNetMode] = useState<'server' | 'p2p'>('server');
  const [p2pSub, setP2pSub] = useState<'host' | 'join'>('host');
  const [invite, setInvite] = useState<{ key: string; code: string } | null>(null);
  const [joinerAnswer, setJoinerAnswer] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const inviteCodeRef = useRef('');
  const [myAnswer, setMyAnswer] = useState('');
  const [hosts, setHosts] = useState<P2PHostInfo[]>([]);
  const [lanServers, setLanServers] = useState<LanServer[]>([]);
  const [lanP2pHosts, setLanP2pHosts] = useState<LanPeer[]>([]);
  const [beaconInfo, setBeaconInfo] = useState<{ ip: string; port: number; ips?: string[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProg, setScanProg] = useState<{ d: number; t: number } | null>(null);
  const [pendingJoins, setPendingJoins] = useState<{ from: string; name: string }[]>([]);
  const [discState, setDiscState] = useState<'off' | 'on'>('off');
  const [discBusy, setDiscBusy] = useState(false);
  const [discMsg, setDiscMsg] = useState('');
  const [hostNotice, setHostNotice] = useState('');
  const [announce, setAnnounce] = useState(false);
  const hostRef = useRef<P2PHost | P2PRelayHost | P2PLanHost | null>(null);
  const [hostMode, setHostMode] = useState<'rtc' | 'relay' | 'lan'>('rtc');
  const p2pClientRef = useRef<P2PClient | P2PRelayClient | P2PLanClient | null>(null);
  /** timer del retry automatico del client LAN dopo un drop (token di rientro) */
  const lanReconnectRef = useRef<number | undefined>(undefined);
  const discRef = useRef<P2PDiscovery | null>(null);
  const discHostIdRef = useRef('');
  const announceTimerRef = useRef<number | undefined>(undefined);
  const discListTimerRef = useRef<number | undefined>(undefined);
  const [savedP2P, setSavedP2P] = useState<SavedP2PCampaign[]>([]);
  const [resumePick, setResumePick] = useState<SavedP2PCampaign | null>(null);
  const persistTimerRef = useRef<number | undefined>(undefined);

  // carica le campagne P2P salvate in locale (host); allo smontare salva lo snapshot residuo
  useEffect(() => {
    void listSavedP2P().then(setSavedP2P);
    return () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      if (hostRef.current) void saveP2PCampaign(hostRef.current.campaign);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadSaved = () => { void listSavedP2P().then(setSavedP2P); };
  // quando entri/esci dall'account ricarica la lista delle passkey registrate
  useEffect(() => {
    if (auth && passkeySupported) void refreshPasskeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.username]);
  /** snapshot immediato della campagna dell'host (senza password) */
  const persistHostNow = () => {
    const h = hostRef.current;
    if (!h) return;
    void saveP2PCampaign(h.campaign).then(reloadSaved);
  };
  /** debounce 3 s: lo stato cambia a ogni azione, non serve scrivere a ogni colpo */
  const schedulePersist = () => {
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = undefined;
      persistHostNow();
    }, 3000);
  };

  const stopDiscovery = () => {
    window.clearInterval(announceTimerRef.current);
    announceTimerRef.current = undefined;
    window.clearInterval(discListTimerRef.current);
    discListTimerRef.current = undefined;
    discRef.current?.close();
    discRef.current = null;
    setDiscState('off');
    setHosts([]);
  };

  /** cambio modalità server<->p2p "pulito": ferma discovery/timer e azzera gli stati residui */
  const switchNetMode = (m: 'server' | 'p2p') => {
    if (m === netMode) return;
    stopDiscovery();
    setHosts([]);
    setLanServers([]);
    setLanP2pHosts([]);
    setPendingJoins([]);
    setDiscMsg('');
    setHostNotice('');
    setInvite(null);
    setJoinerAnswer('');
    setInviteInput('');
    setCodeInput('');
    setInviteCode('');
    inviteCodeRef.current = '';
    setMyAnswer('');
    setScanProg(null);
    setError('');
    setScanning(false);
    if (m === 'p2p' && !url.trim()) setUrl(autoDiscWsUrl());
    setNetMode(m);
  };

  /** host: annunciati su un server LAN così i giocatori ti trovano nella lista */
  /**
   * annuncia l'host su un server 5emanager (serve SOLO per giocatori su un'altra rete).
   * soft=true (chiamata automatica dall'host LAN): se non c'è server, niente errore rosso —
   * in LAN basta QR/codice/indirizzo del beacon, l'host resta valido lo stesso.
   */
  const startAnnounce = async (wsUrl?: string, soft = false) => {
    setError('');
    let u = (wsUrl ?? url).trim() || autoDiscWsUrl();
    // URL salvato ma irraggiungibile (IP vecchio/morto): lo scartiamo subito invece di ritentarlo sempre
    if (u && !(await serverReachable(u))) {
      setUrl('');
      u = '';
    }
    if (!u) {
      // su app nativa (APK) senza URL salvato: prova a trovare da solo un server 5emanager sulla rete
      try {
        const found = await scanLanPeers();
        const srv = found.find((p) => p.kind === 'server');
        if (srv) u = `ws://${srv.ip}:${srv.port}`;
      } catch { /* ignora: si passa al messaggio */ }
    }
    if (!u) {
      if (soft) {
        setDiscMsg(t('cg.p2pNoServerSoft', 'Nessun server 5emanager trovato in LAN: nessun problema — in LAN gli altri entrano con QR / codice breve / indirizzo ws://<ip>:3177. L\'annuncio su server serve solo se i giocatori sono su un\'altra rete.'));
        return;
      }
      setError(t('cg.p2pNoServer', 'Nessun server LAN individuato: inserisci il ws:// del server (es. ws://<ip-del-server>:3001) oppure usa la scansione di rete'));
      return;
    }
    setUrl(u);
    stopDiscovery();
    try {
      const disc = new P2PDiscovery();
      discRef.current = disc;
      // handshake SDP solo se WebRTC c'è; in modalità relay gli handler li mette P2PRelayHost
      if (webrtcSupported() && hostMode === 'rtc') {
        disc.onJoinRequest = (from) => {
          void (async () => {
            try {
              const inv = await (hostRef.current as P2PHost).createInvite();
              disc.offer(from, inv.code);
              setHostNotice(t('cg.p2pInviteSent', '📨 Codice invito inviato al giocatore — in attesa della risposta…'));
            } catch (e) { setError(errMsg(e)); }
          })();
        };
        disc.onAnswer = (_from, code) => {
          void (async () => {
            try {
              await (hostRef.current as P2PHost).acceptAnswer(code);
              setHostNotice('✅ ' + t('cg.p2pPlayerConnected', 'Giocatore collegato!'));
            } catch (e) { setError(errMsg(e)); }
          })();
        };
      }
      // host LAN (beacon): i giocatori che arrivano dal server (codice breve/lista) entrano via relay sulla stessa campagna
      if (hostMode === 'lan' && hostRef.current) (hostRef.current as P2PLanHost).attachDiscovery(disc);
      await disc.connect(u);
      const nm = campaignName || name || 'Campagna P2P';
      disc.announce(nm);
      newShortInviteCode();
      setDiscState('on');
      setDiscMsg(tf('cg.p2pAnnouncedOn', 'Annunciato su {url}', { url: u }));
      // ri-annuncia ogni 30 s (il server tiene annuncio e codice per 90 s)
      window.clearInterval(announceTimerRef.current);
      announceTimerRef.current = window.setInterval(() => {
        if (disc.connected) {
          disc.announce(nm);
          if (inviteCodeRef.current) disc.announceCode(inviteCodeRef.current, nm);
        }
      }, 30_000);
    } catch (e) {
      if (soft) setDiscMsg(tf('cg.p2pAnnounceFailSoft', 'Annuncio su server non riuscito ({e}): in LAN resta valido QR/codice/indirizzo del beacon.', { e: errMsg(e) }));
      else setError(errMsg(e));
    }
  };

  /** smonta host/transport P2P (usato da "Esci" e quando la campagna viene eliminata) */
  const teardownP2P = () => {
    stopDiscovery();
    if (persistTimerRef.current) { window.clearTimeout(persistTimerRef.current); persistTimerRef.current = undefined; }
    persistHostNow(); // snapshot finale della campagna
    if (hostRef.current && 'close' in hostRef.current) (hostRef.current as P2PLanHost).close();
    hostRef.current = null;
    setHostMode('rtc');
    setBeaconInfo(null);
    if (lanReconnectRef.current) { window.clearTimeout(lanReconnectRef.current); lanReconnectRef.current = undefined; }
    p2pClientRef.current?.close();
    p2pClientRef.current = null;
    setP2PTransport(null);
    setInvite(null);
    setJoinerAnswer('');
    setInviteInput('');
    setCodeInput('');
    setInviteCode('');
    inviteCodeRef.current = '';
    setMyAnswer('');
    setHostNotice('');
    setDiscMsg('');
  };

  /** wrappa i messaggi di rete: su campaignDeleted disconnetti anche il trasporto P2P */
  const onNetMessage = (m: any) => {
    handleNetMessage(m);
    if (m?.t === 'campaignDeleted') teardownP2P();
    else if (m?.t === 'joinPending' || m?.t === 'p2pJoinSent') setDiscMsg('✅ ' + t('cg.p2pJoinAcked', 'Richiesta ricevuta dall\'host — in attesa che il master ti accetti (✅)'));
  };

  const hostCb = {
    onMessage: () => {},
    onState: (c: any) => {
      setConn((prev) => (prev.phase === 'online' ? { ...prev, campaign: c } : prev));
      schedulePersist();
    },
    onPeerJoined: () => {},
    onPeerLeft: () => {},
    onJoinPending: (req: { from: string; name: string }) => setPendingJoins((p) => (p.some((x) => x.from === req.from) ? p : [...p, req])),
    onCampaignDeleted: () => {
      setConn({ phase: 'offline' });
      setError(t('cg.campaignDeletedSelf', 'Campagna eliminata: tutti i partecipanti sono stati disconnessi.'));
      teardownP2P();
    },
  };

  /** se l'utente ha scelto "Riprendi" da una campagna salvata, carica lo snapshot (serve la password: non è salvata) */
  const resolveExisting = async (): Promise<{ existing?: Campaign; abort?: boolean }> => {
    if (!resumePick) return {};
    const saved = await getSavedP2P(resumePick.id);
    if (!saved) {
      setResumePick(null);
      setError(t('cg.p2pSavedMissing', 'Campagna salvata non trovata (forse eliminata).'));
      return { abort: true };
    }
    // la password è facoltativa e non viene salvata: quella che metti ora (anche vuota) è la nuova
    setCampaignName(saved.name);
    return { existing: saved.campaign };
  };

  const pickResume = (s: SavedP2PCampaign) => {
    setResumePick(s);
    setCampaignName(s.name);
    setPassword('');
    setError('');
  };

  // la tab "Campagne P2P" può chiedere di riprendere una campagna salvata (pulsante Riprendi)
  useEffect(() => onResumeRequest((id) => {
    void getSavedP2P(id).then((s) => {
      if (s) pickResume(s);
      else setError(t('cg.p2pSavedMissing', 'Campagna salvata non trovata (forse eliminata).'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const startP2PHost = async () => {
    setError('');
    const res = await resolveExisting();
    if (res.abort) return;
    const existing = res.existing;
    // su app nativa (AppImage/desktop/APK) il beacon LAN è il trasporto migliore:
    // WebSocket diretto, funziona anche senza WebRTC (WebKitGTK) e senza server
    if (lanBeaconSupported()) {
      await startLanHost(existing);
      // se spuntato "annunciati su un server", l'host LAN si annuncia anche lì (codice breve per chi non è in LAN)
      if (announce) void startAnnounce(undefined, true);
      return;
    }
    // senza WebRTC (browser/vecchie build) si usa il trasporto relay sul server LAN
    if (!webrtcSupported()) {
      const u = url.trim() || autoDiscWsUrl();
      if (!u) {
        setError(t('cg.p2pNoServerNoWebrtc', 'WebRTC non disponibile su questo dispositivo e nessun server LAN individuato: imposta il ws:// del server (es. ws://192.168.1.10:3001) oppure usa 🌐 Server remoto'));
        return;
      }
      setUrl(u);
      try {
        const disc = new P2PDiscovery();
        discRef.current = disc;
        await disc.connect(u);
        const host = new P2PRelayHost({ campaignName, password, masterName: name || 'Master', reg, disc, cb: hostCb, existing });
        hostRef.current = host;
        setHostMode('relay');
        setConn({ phase: 'online', campaign: host.campaign, you: host.campaign.players[0] });
        setResumePick(null);
        persistHostNow();
        setP2PTransport((m: any) => {
          if (m?.t === 'action') host.applyAction(host.masterId, m.action);
        });
        const nm = campaignName || name || 'Campagna P2P';
        disc.announce(nm);
        newShortInviteCode();
        setDiscState('on');
        setDiscMsg(tf('cg.p2pAnnouncedOn', 'Annunciato su {url}', { url: u }));
        window.clearInterval(announceTimerRef.current);
        announceTimerRef.current = window.setInterval(() => {
          if (disc.connected) {
            disc.announce(nm);
            if (inviteCodeRef.current) disc.announceCode(inviteCodeRef.current, nm);
          }
        }, 30_000);
      } catch (e) {
        setError(errMsg(e));
      }
      return;
    }
    const host = new P2PHost({
      campaignName, password, masterName: name || 'Master', reg,
      cb: hostCb, existing,
    });
    hostRef.current = host;
    setHostMode('rtc');
    setConn({ phase: 'online', campaign: host.campaign, you: host.campaign.players[0] });
    setResumePick(null);
    persistHostNow();
    setP2PTransport((m: any) => {
      if (m?.t === 'action') host.applyAction(host.masterId, m.action);
    });
    if (announce) void startAnnounce();
  };

  /**
   * HOST "stile Soul Knight": questo dispositivo apre il beacon LAN (porta 3177) e
   * diventa la campagna: gli altri, sulla stessa WiFi/hotspot, lo trovano con
   * "Scansiona rete" e si uniscono con un tap. Niente server, niente codici.
   */
  const startLanHost = async (existing?: Campaign) => {
    setError('');
    if (!existing) {
      const r = await resolveExisting();
      if (r.abort) return;
      existing = r.existing;
    }
    if (!lanBeaconSupported()) {
      setError(t('cg.lanNoNative', 'Beacon LAN disponibile solo nell\'app (AppImage/desktop/Android): dal browser usa la modalità server o il codice invito.'));
      return;
    }
    try {
      const nm = campaignName || name || 'Campagna LAN';
      // codice invito breve pubblicato SUL BEACON (serverless): chi è in LAN lo risolve via scansione
      const code = newInviteCode();
      inviteCodeRef.current = code;
      setInviteCode(code);
      await beaconStart(LAN_BEACON_PORT, nm, code);
      void beaconSetCode(code);
      const host = new P2PLanHost({ campaignName: nm, password, masterName: name || 'Master', reg, cb: hostCb, existing });
      hostRef.current = host;
      setHostMode('lan');
      setConn({ phase: 'online', campaign: host.campaign, you: host.campaign.players[0] });
      setResumePick(null);
      persistHostNow();
      setP2PTransport((m: any) => {
        if (m?.t === 'action') host.applyAction(host.masterId, m.action);
      });
      const ips = await detectLocalIps();
      const ip = ips[0] ?? (await detectLocalIp()) ?? '0.0.0.0';
      // autodiagnosi: il beacon deve rispondere anche su 127.0.0.1 dentro l'app (cleartext OK)
      try {
        const r = await fetch(`http://127.0.0.1:${LAN_BEACON_PORT}/api/info`, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
      } catch (e) {
        setError(tf('cg.lanBeaconSelfFail', 'Beacon avviato ma non risponde nemmeno in locale (127.0.0.1:{port}): {e} — riavvia l\'host.', { port: LAN_BEACON_PORT, e: errMsg(e) }));
      }
      // la card host (sotto) mostra già "In onda su ws://ip:3177": niente messaggio duplicato
      setBeaconInfo({ ip, port: LAN_BEACON_PORT, ips });
    } catch (e) {
      setError(errMsg(e));
    }
  };

  /** joueur: incolla/scansiona l'indirizzo dell'host LAN (ws://ip:porta o 5ELAN:...) → WS diretto */
  const [lanUrl, setLanUrl] = useState('');
  const joinLanUrl = (raw: string) => {
    setError('');
    let u = raw.trim();
    if (u.toLowerCase().startsWith('5elan:')) u = u.slice('5elan:'.length);
    if (!/^wss?:\/\//.test(u)) u = 'ws://' + u;
    const m = u.match(/^wss?:\/\/([^:/]+)(?::(\d+))?/);
    if (!m) {
      setError(t('cg.lanInvalid', 'Indirizzo non valido: usa ws://<ip>:<porta> (es. ws://192.168.1.76:3177)'));
      return;
    }
    void joinLanPeer({ ip: m[1], port: Number(m[2] ?? LAN_BEACON_PORT), kind: 'p2p', name: u });
  };
  /**
   * instrada un QR scansionato (o un deep link 5ELAN:/5EP2P1: aperto dalla fotocamera
   * di sistema): 5ELAN:.../ws://.../host:porta -> host LAN via WS diretto;
   * 5EP2P1:... -> codice invito WebRTC. Così qualsiasi pulsante QR va bene con qualsiasi codice.
   */
  const routeScannedQr = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    const low = s.toLowerCase();
    if (netMode !== 'p2p') switchNetMode('p2p');
    setP2pSub('join');
    if (low.startsWith('5ecode:')) {
      joinByInviteCode(s.slice('5ecode:'.length));
      return;
    }
    if (low.startsWith('5ep2p1:')) {
      setInviteInput(s);
      setError('');
      return;
    }
    if (low.startsWith('5elan:') || /^wss?:\/\//i.test(s) || /^[a-z0-9.-]+:\d+$/i.test(s)) {
      joinLanUrl(s);
      return;
    }
    // altro: prova come codice invito (l'eventuale errore arriva da decodeBlob)
    setInviteInput(s);
  };

  const scanLanQr = async () => {
    try { routeScannedQr(await scanQr()); } catch (e) { setError(errMsg(e)); }
  };

  /** giocatore: un tap su un host P2P trovato in LAN → WS diretto, niente codici */
  const joinLanPeer = async (peer: LanPeer) => {
    setError('');
    setDiscMsg(tf('cg.p2pJoiningLan', 'Mi collego a "{name}" ({ip})…', { name: peer.name ?? 'host', ip: peer.ip }));
    try {
      const client = new P2PLanClient(peer.ip, peer.port);
      client.onMessage = (m) => onNetMessage(m);
      p2pClientRef.current = client;
      setP2PTransport((m) => client.send(m as never));
      const hostKey = `lan:${peer.ip}:${peer.port}`;
      let attempt = 0;
      // drop del socket verso il beacon: riconnessione automatica con backoff (stesso playerId via token)
      client.onClose = () => {
        if (lanReconnectRef.current) window.clearTimeout(lanReconnectRef.current);
        const delay = Math.min(1000 * Math.pow(2, attempt), 10_000);
        attempt += 1;
        setDiscMsg(t('cg.p2pLanReconnecting', '🔌 Connessione all\'host persa — riconnessione automatica in corso…'));
        lanReconnectRef.current = window.setTimeout(() => {
          void (async () => {
            try {
              await client.connect();
              attempt = 0;
              client.onOpen = () => client.join(name || 'Giocatore', password, hostKey);
              client.join(name || 'Giocatore', password, hostKey);
            } catch {
              client.onClose?.();
            }
          })();
        }, delay);
      };
      await client.connect();
      client.onOpen = () => client.join(name || 'Giocatore', password, hostKey);
      client.join(name || 'Giocatore', password, hostKey);
      setDiscMsg(t('cg.p2pJoinSent', '📨 Richiesta inviata all\'host — in attesa della risposta del master…'));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  /** host: genera un codice invito BREVE (XXXX-XXXX) relayato dal server: il giocatore lo digita/scansiona e entra da solo */
  const newShortInviteCode = (): string => {
    const code = newInviteCode();
    inviteCodeRef.current = code;
    setInviteCode(code);
    void beaconSetCode(code); // pubblicato sul beacon: risolvibile in LAN senza server
    const disc = discRef.current;
    const nm = campaignName || name || 'Campagna P2P';
    if (disc?.connected) {
      disc.announceCode(code, nm);
      setHostNotice(tf('cg.p2pCodeReady', 'Codice invito breve: {code} — il giocatore lo inserisce (o scansiona il QR) e si unisce da solo.', { code }));
    }
    return code;
  };

  /** host: genera un nuovo codice invito da dare al giocatore */
  const newInvite = async () => {
    setError('');
    setHostNotice('');
    try {
      setInvite(await (hostRef.current as P2PHost).createInvite());
    } catch (e) { setError(errMsg(e)); }
  };

  /** host: applica la risposta incollata dal giocatore */
  const acceptJoiner = async () => {
    setError('');
    try {
      await (hostRef.current as P2PHost).acceptAnswer(joinerAnswer, invite?.key);
      setJoinerAnswer('');
      setInvite(null);
      setHostNotice('✅ ' + t('cg.p2pPlayerConnected', 'Giocatore collegato!'));
    } catch (e) { setError(errMsg(e)); }
  };

  const makeP2PClient = () => {
    const client = new P2PClient();
    client.onMessage = (m) => onNetMessage(m);
    client.onOpen = () => client.join(name || 'Giocatore', password, 'disc:' + (discHostIdRef.current ?? 'rtc'));
    p2pClientRef.current = client;
    setP2PTransport((m) => client.send(m as never));
    return client;
  };

  /** un tasto: scansiona la rete locale (server 5emanager + host P2P dei dispositivi), poi cerca gli host */
  const scanAndSearch = async () => {
    setScanning(true);
    setScanProg(null);
    setLanServers([]);
    setLanP2pHosts([]);
    let foundCount = -1;
    let netInfo = '';
    try {
      const myIp = await detectLocalIp();
      netInfo = myIp ? tf('cg.p2pScanNetInfo', 'il tuo IP è {ip} — scansiono la rete {net}/24', { ip: myIp, net: myIp.split('.').slice(0, 3).join('.') }) : '';
      // deadline: la scansione non deve mai bloccare i pulsanti all'infinito
      const found = await Promise.race([
        scanLanPeers((d, t2) => setScanProg({ d, t: t2 })),
        new Promise<LanPeer[]>((r) => setTimeout(() => r([]), 25_000)),
      ]);
      foundCount = found.length;
      const servers = found.filter((p) => p.kind === 'server');
      const p2p = found.filter((p) => p.kind === 'p2p');
      setLanServers(servers);
      setLanP2pHosts(p2p);
      if (servers.length > 0) setUrl(`ws://${servers[0].ip}:${servers[0].port}`);
    } catch { /* no WebRTC: si può sempre inserire l'IP a mano */ }
    finally {
      setScanning(false);
    }
    // cerca la lista host sul server SOLO se abbiamo un URL valido (mai ws://localhost su app nativa)
    const u = url.trim() || autoDiscWsUrl();
    if (u) {
      await searchHosts();
    } else if (foundCount === 0) {
      setDiscMsg((netInfo ? netInfo + ' — ' : '') + t('cg.p2pScanNone', 'Niente trovato sulla rete. Controlla: (1) dispositivi sulla stessa WiFi/hotspot e stessa sottorete (l\'IP del telefono e del PC devono iniziare uguale); (2) sull\'altro dispositivo è stato premuto "Ospita su questa rete (LAN)"; (3) il firewall non blocca la porta 3177; (4) dal telefono apri nel browser http://<ip-del-pc>:3177/api/info per verificare che il beacon risponda; (5) riavvia l\'host.'));
    } else {
      setDiscMsg((netInfo ? netInfo + ' — ' : '') + t('cg.p2pNoServerScan', 'Nessun server 5emanager trovato in rete — se cerchi una campagna P2P diretta usa gli host LAN qui sotto (tap per entrare), oppure inserisci il ws:// del server remoto a mano.'));
    }
  };

  /** giocatore: un tasto solo — trova il server LAN da solo e lista gli host (auto-refresh 8 s) */
  const searchHosts = async () => {
    setError('');
    setDiscBusy(true);
    setDiscMsg('');
    setHosts([]);
    const u = url.trim() || autoDiscWsUrl();
    // su app nativa (APK) ws://localhost non esiste: non provarci nemmeno
    let localhostOnNative = false;
    try {
      localhostOnNative = detectPlatform() !== 'web' && !!u && isLocalhostHost(new URL(u).host);
    } catch { /* url malformato: si prova lo stesso */ }
    if (!u || localhostOnNative) {
      setDiscBusy(false);
      setError(t('cg.p2pNoServer', 'Nessun server individuato: premi "Scansiona rete e cerca host" (trova server e host P2P diretti in LAN) oppure inserisci il ws:// del server remoto (es. wss://dnd.tuosito.it)'));
      return;
    }
    setUrl(u);
    stopDiscovery();
    try {
      const disc = new P2PDiscovery();
      discRef.current = disc;
      disc.onHosts = (h) => setHosts(h);
      await disc.connect(u);
      setDiscState('on');
      setDiscMsg(tf('cg.p2pDiscOn', 'Cerco host su {url}…', { url: u }));
      disc.list();
      window.clearInterval(discListTimerRef.current);
      discListTimerRef.current = window.setInterval(() => { if (disc.connected) disc.list(); }, 8000);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setDiscBusy(false);
    }
  };

  /** giocatore: unisciti con un click a un host trovato via discovery (il server fa solo da relay).
   *  skipJoin=true quando la richiesta di join è già stata inviata (es. con p2pJoinCode). */
  const joinDiscoveredHost = (hostId: string, hostName: string, skipJoin = false) => {
    setError('');
    setDiscMsg(tf('cg.p2pJoining', 'Richiesta inviata a "{name}"…', { name: hostName }));
    discHostIdRef.current = hostId;
    const disc = discRef.current;
    if (!disc) return;
    // senza WebRTC: niente SDP, si entra direttamente col join relayato
    if (!webrtcSupported()) {
      const client = new P2PRelayClient(disc, hostId);
      client.onMessage = (m) => onNetMessage(m);
      p2pClientRef.current = client;
      setP2PTransport((m) => client.send(m as never));
      if (!skipJoin) client.join(name || 'Giocatore', password, getP2PRejoinToken('relay:' + hostId));
      return;
    }
    const client = makeP2PClient();
    disc.onOffer = (from, _n, code) => {
      void (async () => {
        try {
          const answer = await client.acceptInvite(code);
          disc.answer(from, answer);
          setDiscMsg(t('cg.p2pAnswerSent', 'Risposta inviata — apertura del canale in corso…'));
        } catch (e) { setError((e as Error).message); }
      })();
    };
    if (!skipJoin) disc.join(hostId, name || 'Giocatore', password, getP2PRejoinToken('relay:' + hostId));
  };

  /**
   * giocatore: unisciti con un codice invito BREVE (XXXX-XXXX).
   * 1) SERVERLESS: scansione LAN — il beacon dell'host pubblica il codice in /api/info,
   *    chi è sulla stessa rete lo risolve e si collega diretto (ws://ip:3177), senza server.
   * 2) alternativa SOLO se in reti diverse: server 5emanager che risolve il codice e relay SDP.
   */
  const joinByInviteCode = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setError('');
    setCodeInput(code);
    const norm = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setScanning(true);
    setDiscMsg(tf('cg.p2pCodeJoining', 'Cerco il codice {code} sulla rete locale…', { code }));
    try {
      // deadline: la scansione non deve mai bloccare il pulsante all'infinito
      const peers = await Promise.race([
        scanLanPeers((d, t2) => setScanProg({ d, t: t2 })),
        new Promise<LanPeer[]>((r) => setTimeout(() => r([]), 20_000)),
      ]);
      const hit = peers.find((p) => p.kind === 'p2p' && p.code && norm(p.code) === norm(code));
      if (hit) {
        setDiscMsg(tf('cg.p2pCodeFoundLan', 'Host {ip} trovato in LAN col codice — mi collego…', { ip: hit.ip }));
        void joinLanPeer(hit);
        return;
      }
    } catch { /* scansione fallita: si prova col server */ } finally {
      setScanning(false);
    }
    // non trovato in LAN: prova via server (se connesso), altrimenti errore con guida
    const disc = discRef.current;
    if (disc?.connected) {
      setDiscMsg(tf('cg.p2pCodeJoiningSrv', 'Non trovato in LAN: provo col codice {code} via server…', { code }));
      disc.onCodeHost = (hostId, hostName) => joinDiscoveredHost(hostId, hostName || code, true);
      disc.joinByCode(code, name || 'Giocatore', password, getP2PRejoinToken('code:' + code));
      return;
    }
    setError(tf('cg.p2pCodeNotFound', 'Codice {code} non trovato sulla rete locale: siete sulla stessa WiFi/hotspot? Su reti diverse l\'host deve annunciarsi su un server 5emanager (oppure si scambia il codice SDP 5EP2P1:…).', { code }));
  };

  /** giocatore: incolla/scansiona il codice invito e genera la risposta */
  const manualAnswer = async () => {
    setError('');
    try {
      const client = makeP2PClient();
      const answer = await client.acceptInvite(inviteInput);
      setMyAnswer(answer);
      if (discRef.current?.connected && discHostIdRef.current) discRef.current.answer(discHostIdRef.current, answer);
    } catch (e) { setError((e as Error).message); }
  };

  const scanInvite = async () => {
    try { routeScannedQr(await scanQr()); } catch (e) { setError((e as Error).message); }
  };

  const exitP2P = () => {
    teardownP2P();
    disconnect();
  };

  // deep link (QR 5ELAN:/5EP2P1: aperto dalla fotocamera di sistema): instrada come una scansione
  useEffect(() => {
    const off = onDeepLink((raw) => { consumePendingDeepLink(); routeScannedQr(raw); });
    const first = consumePendingDeepLink();
    if (first) routeScannedQr(first);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [password, setPassword] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [asMaster, setAsMaster] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountPw, setAccountPw] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [localPick, setLocalPick] = useState('');
  const [accPick, setAccPick] = useState('');
  const [targetId, setTargetId] = useState('');
  const [enemyId, setEnemyId] = useState('');
  const [moveAmt, setMoveAmt] = useState(6);
  const [xpAllAmt, setXpAllAmt] = useState(300);
  const [showTpl, setShowTpl] = useState(false);
  const [tplShape, setTplShape] = useState<TemplateShape>('cone');
  const [tplSize, setTplSize] = useState(15);
  const [tplWidth, setTplWidth] = useState(5);
  const [gName, setGName] = useState('');
  const [gQty, setGQty] = useState(1);
  const [gValue, setGValue] = useState('');
  const [gRarity, setGRarity] = useState<ItemRarity | ''>('');
  const [gMagic, setGMagic] = useState(false);
  const [giveTarget, setGiveTarget] = useState('');
  const [gGp, setGGp] = useState(0);
  const [genResult, setGenResult] = useState<{ kind: 'name' | 'enc' | 'tre'; text: string; enemies?: { enemyId: string; count: number }[]; xp?: number; currency?: Partial<Currency>; items?: { name: string; quantity?: number; valueGp?: number; rarity?: ItemRarity; magic?: boolean }[] } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [timerSec, setTimerSec] = useState(60);
  const [timerLeft, setTimerLeft] = useState(60);
  const [timerOn, setTimerOn] = useState(false);

  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); fn(); }
  };

  // modalità vista: tieni la scheda del giocatore sincronizzata con lo stato della campagna
  useEffect(() => {
    if (conn.phase === 'online' && viewChar) {
      const ch = conn.campaign.characters[viewChar.id];
      if (ch && ch !== viewChar) setViewChar(ch, viewLabel);
    }
  }, [conn, viewChar, viewLabel, setViewChar]);

  // entrando in una campagna: scheda DEDICATA "campagna:<id>" (la locale resta separata e intatta)
  const camp = conn.phase === 'online' ? conn.campaign : null;
  useEffect(() => {
    if (!camp) return;
    setCampaignMeta(camp.id, { name: camp.name, server: url });
    let cs = getCampaignSheet(camp.id);
    if (!cs && char && !isCampaignSheetId(char.id)) {
      cs = { ...char, id: campaignSheetId(camp.id) };
      setCampaignSheet(camp.id, cs);
    }
    if (cs) {
      selectSheet(cs.id);
      act({ kind: 'setCharacter', character: cs });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camp?.id]);

  // mentre sei online, ogni modifica alla scheda di campagna viene inviata al server
  // (e salvata nella libreria dell'account, se loggato) — debounce 1.5 s
  useEffect(() => {
    if (!camp || !char || char.id !== campaignSheetId(camp.id)) return;
    const h = window.setTimeout(() => {
      act({ kind: 'setCharacter', character: char });
      if (auth) act({ kind: 'saveCharacter', character: char });
    }, 1500);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char, camp?.id, auth?.username]);

  // timer di turno (locale, per dispositivo): riparte a ogni cambio turno
  const combatTurnKey = conn.phase === 'online' ? conn.campaign.combat?.turnIndex ?? -1 : -1;
  useEffect(() => {
    if (conn.phase === 'online' && conn.campaign.combat) {
      setTimerLeft(timerSec);
      setTimerOn(true);
      // turno evidente: beep quando inizia il TUO turno
      const cb = conn.campaign.combat;
      const c0 = cb.combatants[cb.turnIndex];
      if (c0?.isPlayer && char && c0.id === char.id) turnBeep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combatTurnKey]);
  useEffect(() => {
    if (!timerOn) return;
    const iv = window.setInterval(() => setTimerLeft((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(iv);
  }, [timerOn]);
  useEffect(() => { if (timerLeft === 0 && timerOn) setTimerOn(false); }, [timerLeft, timerOn]);

  if (conn.phase !== 'online') {
    if (netMode === 'p2p') {
      return (
        <div className="grid" style={{ maxWidth: 560 }}>
          <div className="card">
            <h3><Icon name="signal" candy size={16} /> {t('cg.p2pTitle', 'Campagna P2P — senza server')}</h3>
            {!webrtcSupported() && !lanBeaconSupported() && (
              <div className="error" style={{ marginBottom: 8 }}>
                ⚠️ {t('cg.p2pNoWebrtc', 'WebRTC non supportato su questo dispositivo: il P2P usa il trasporto relay sul server LAN — assicurati di aver impostato il ws:// del server.')}
              </div>
            )}
            {!webrtcSupported() && lanBeaconSupported() && (
              <div className="ok" style={{ marginBottom: 8 }}>
                🖥️ {t('cg.p2pLanNative', 'Su questa app il P2P usa il beacon LAN (WebSocket diretto): premi "Avvia host" — gli altri ti trovano con "Scansiona rete" e entrano con un tap.')}
              </div>
            )}
            <div className="segmented" style={{ marginBottom: 8 }}>
              <button className={`seg ${(netMode as string) === 'server' ? 'active' : ''}`} onClick={() => switchNetMode('server')}>
                <Icon name="globe" candy size={15} /> {t('cg.remoteServer', 'Server remoto')}
              </button>
              <button className={`seg ${(netMode as string) === 'p2p' ? 'active' : ''}`} onClick={() => switchNetMode('p2p')}>
                <Icon name="signal" candy size={15} /> {t('cg.p2pHost', 'P2P (host sul mio dispositivo)')}
              </button>
            </div>
            <div className="segmented" style={{ marginBottom: 8 }}>
              <button className={`seg ${p2pSub === 'host' ? 'active' : ''}`} onClick={() => setP2pSub('host')}>
                <Icon name="monitor" candy size={15} /> {t('cg.host', 'Faccio da host')}
              </button>
              <button className={`seg ${p2pSub === 'join' ? 'active' : ''}`} onClick={() => setP2pSub('join')}>
                <Icon name="door" candy size={15} /> {t('cg.joinHost', 'Mi unisco a un host')}
              </button>
            </div>
            {p2pSub === 'host' && (
              <>
                <label>{t('cg.campaignName', 'Nome campagna')}</label>
                <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} onKeyDown={onEnter(startP2PHost)} placeholder="La tomba perduta" />
                <label>{t('cg.p2pPassword', 'Password campagna (facoltativa)')}</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter(startP2PHost)} placeholder={t('cg.p2pPasswordPh', 'vuota = aperta a chi ha codice/indirizzo')} />
                <label>{t('cg.yourName', 'Il tuo nome')} (master)</label>
                <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter(startP2PHost)} placeholder="Master" />
                <label className="row" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={announce}
                    onChange={(e) => {
                      setAnnounce(e.target.checked);
                      if (e.target.checked && (!url.trim() || /127\.0\.0\.1|localhost/.test(url))) setUrl(autoDiscWsUrl());
                    }}
                    style={{ width: 'auto' }}
                  />
                  <span>{t('cg.p2pAnnounce', '📡 Annunciati su un server LAN: chi è sulla stessa rete ti vede nella lista host e si unisce con un click')}</span>
                </label>
                {announce && (
                  <div className="row" style={{ marginTop: 4 }}>
                    <input value={url} onChange={(e) => setUrl(e.target.value)} list="saved-servers-p2p-host" placeholder="ws://192.168.1.10:3001 (auto se vuoto)" style={{ flex: 1 }} />
                    <datalist id="saved-servers-p2p-host">
                      {servers.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                )}
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="primary" onClick={startP2PHost}>{t('cg.startHost', 'Avvia host P2P')}</button>
                  {lanBeaconSupported() && (
                    <button className="primary" onClick={() => void startLanHost()} title={t('cg.hostLanTitle', 'Questo dispositivo diventa la campagna: gli altri sulla stessa rete ti trovano con un tasto e si uniscono con un tap')}>
                      <Icon name="monitor" candy size={15} /> {t('cg.hostLan', 'Ospita su questa rete (LAN)')}
                    </button>
                  )}
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  {t('cg.p2pHostHint', "Nessun server né dominio: tu sei l'host (anche da smartphone con hotspot). Con \"Ospita su questa rete\" gli amici sulla stessa WiFi ti vedono subito (un tap e sono dentro, li accetti tu); altrimenti usi il codice invito (testo/QR) qui sotto.")}
                </div>
                {resumePick && (
                  <div className="ok" style={{ marginTop: 8 }}>
                    ▶️ {tf('cg.p2pResumePicked', 'Riprendi "{name}": reinserisci la password e avvia l\'host (la password non viene salvata).', { name: resumePick.name })}
                  </div>
                )}
                <div className="muted" style={{ marginTop: 8 }}>
                  {tf('cg.p2pSavedLink', '💾 {n} campagne salvate: gestiscile (riprendi / rinomina / elimina / sync col server) dalla tab "Campagne P2P".', { n: savedP2P.length })}
                </div>
              </>
            )}
            {p2pSub === 'join' && (
              <>
                <label>{t('cg.yourName', 'Il tuo nome')}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter(searchHosts)} placeholder="Eroe" />
                <label>{t('cg.password', 'Password campagna')}</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter(searchHosts)} />
                <div className="muted" style={{ fontSize: 11 }}>{t('cg.p2pPasswordHint', 'Facoltativa: se l\'host non l\'ha impostata, lascia vuoto.')}</div>

                <div style={{ marginTop: 12, padding: 10, background: 'var(--panel2)', borderRadius: 8 }}>
                  <b>{t('cg.p2pFindHosts', '🔍 Trova host sulla stessa rete')}</b>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t('cg.p2pFindHostsHint', "Un tasto: scansiona la rete locale, trova i server 5emanager e gli host che annunciano la campagna — niente IP da scrivere.")}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="primary" onClick={scanAndSearch} disabled={discBusy || scanning}>
                      <Icon name="radar" candy size={15} />
                      {scanning
                        ? tf('cg.p2pScanning', ' Scansiono la rete… {d}/{t}', { d: scanProg?.d ?? 0, t: scanProg?.t ?? 0 })
                        : discBusy
                          ? t('cg.p2pSearching', 'Cerco…')
                          : t('cg.p2pScanNet', 'Scansiona rete e cerca host')}
                    </button>
                    {discState === 'on' && <button title={t('cg.p2pRefreshHosts', 'Aggiorna lista host')} onClick={() => discRef.current?.list()}>↻</button>}
                  </div>
                  {lanServers.length > 0 && (
                    <div className="row" style={{ marginTop: 6 }}>
                      <span className="muted">{t('cg.p2pServersFound', 'server 5emanager trovati:')}</span>
                      {lanServers.map((s) => (
                        <button
                          key={s.ip + ':' + s.port}
                          className={`tag ${url.includes(s.ip) ? 'custom' : ''}`}
                          style={{ cursor: 'pointer' }}
                          title={t('cg.p2pUseServer', 'Usa questo server per la lista host')}
                          onClick={() => { setUrl(`ws://${s.ip}:${s.port}`); void searchHosts(); }}
                        >
                          <Icon name="globe" size={12} /> {s.name ?? 'server'} ({s.ip})
                        </button>
                      ))}
                    </div>
                  )}
                  {lanP2pHosts.length > 0 && (
                    <div className="row" style={{ marginTop: 6 }}>
                      <span className="muted">{t('cg.p2pLanHostsFound', '🎮 host di campagna su questa rete (tap per entrare):')}</span>
                      {lanP2pHosts.map((p) => (
                        <button
                          key={p.ip + ':' + p.port}
                          className="tag custom lan-host-btn"
                          style={{ cursor: 'pointer', fontSize: 13, padding: '4px 10px' }}
                          onClick={() => void joinLanPeer(p)}
                        >
                          <Icon name="play" candy size={13} /> {p.name ?? 'host'} ({p.ip})
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {tf('cg.p2pDiscUsing', 'server: {url} (manuale se la scansione non trova nulla)', { url: url || autoDiscWsUrl() || '—' })}
                    {servers.length > 0 && (
                      <span> · <select value="" onChange={(e) => { if (e.target.value) setUrl(e.target.value); }} style={{ width: 'auto' }}>
                        <option value="">{t('cg.p2pOtherServer', 'altro server salvato…')}</option>
                        {servers.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select></span>
                    )}
                  </div>
                  {discMsg && <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>{discMsg}</div>}
                  {hosts.length > 0 && (
                    <div className="row" style={{ marginTop: 6 }}>
                      <span className="muted">{tf('cg.p2pHostsFound', '{n} host trovato/i:', { n: hosts.length })}</span>
                      {hosts.map((h) => (
                        <button key={h.id} className="tag custom" style={{ cursor: 'pointer', fontSize: 13, padding: '4px 10px' }} onClick={() => joinDiscoveredHost(h.id, h.name)}>
                          <Icon name="play" size={11} /> {h.name}{h.ip ? ` (${h.ip})` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                  {discState === 'on' && !discBusy && hosts.length === 0 && (
                    <div className="muted" style={{ marginTop: 6 }}>{t('cg.p2pNoHosts', "Nessun host trovato ora: l'host deve aver spuntato l'annuncio (o usa il codice manuale qui sotto).")}</div>
                  )}
                </div>

                <div style={{ marginTop: 12, padding: 10, background: 'var(--panel2)', borderRadius: 8 }}>
                  <b><Icon name="key" candy size={15} /> {t('cg.p2pCodeTitle', "Codice invito breve (se l'host te lo ha dato)")}</b>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {t('cg.p2pCodeHint', "L'host mostra un codice tipo AB3F-K9Q2 (o un QR 5ECODE:…): digitalo qui o lo scansiono — entro senza incollare codici lunghi.")}
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <input
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                      onKeyDown={onEnter(() => joinByInviteCode(codeInput))}
                      placeholder={t('cg.p2pCodePh', 'AB3F-K9Q2')}
                      style={{ flex: 1, fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase' }}
                    />
                    <button className="primary" disabled={!codeInput.trim()} onClick={() => void joinByInviteCode(codeInput)}>
                      <Icon name="play" candy size={13} /> {t('cg.p2pJoinByCode', 'Unisciti')}
                    </button>
                    <button onClick={scanInvite} title={t('cg.p2pScanTitle', "Scansiona il QR mostrato dall'host")}>
                      <Icon name="qr" size={14} /> {t('cg.p2pScan', 'QR')}
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 12, padding: 10, background: 'var(--panel2)', borderRadius: 8 }}>
                  <b><Icon name="monitor" candy size={15} /> {t('cg.lanManualTitle', 'Collegati a un host LAN a mano (QR o indirizzo)')}</b>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {t('cg.lanManualHint', "Se la scansione automatica non trova l'host: sull'host c'è un QR con l'indirizzo — scancialo qui, oppure incollalo sotto.")}
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <input
                      value={lanUrl}
                      onChange={(e) => setLanUrl(e.target.value)}
                      onKeyDown={onEnter(() => joinLanUrl(lanUrl))}
                      placeholder="ws://192.168.1.76:3177 oppure 5ELAN:ws://…"
                      style={{ flex: 1 }}
                    />
                    <button className="primary" disabled={!lanUrl.trim()} onClick={() => joinLanUrl(lanUrl)}>
                      <Icon name="play" candy size={13} /> {t('cg.lanConnect', 'Connetti')}
                    </button>
                    <button onClick={scanLanQr} title={t('cg.p2pScanTitle', "Scansiona il QR mostrato dall'host")}>
                      <Icon name="qr" size={14} /> {t('cg.p2pScan', 'QR')}
                    </button>
                  </div>
                </div>

                {webrtcSupported() && (
                <div style={{ marginTop: 12 }}>
                  <b>{t('cg.p2pManual', "✍️ Oppure incolla il codice invito dell'host")}</b>
                  <div className="row" style={{ marginTop: 6 }}>
                    <textarea rows={3} value={inviteInput} onChange={(e) => setInviteInput(e.target.value)} placeholder="5EP2P1:…" style={{ flex: 1 }} />
                    <button onClick={scanInvite} title={t('cg.p2pScanTitle', 'Scansiona il QR mostrato dall\'host')}>{t('cg.p2pScan', '📷 QR')}</button>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button className="primary" disabled={!inviteInput.trim()} onClick={manualAnswer}>{t('cg.p2pGenAnswer', '1️⃣ Genera risposta')}</button>
                  </div>
                  {myAnswer && (
                    <>
                      <label style={{ marginTop: 8 }}>{t('cg.p2pAnswerToHost', "2️⃣ Dai questa risposta all'host (copia o condividi):")}</label>
                      <textarea readOnly rows={3} value={myAnswer} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
                      <div className="row" style={{ marginTop: 6 }}>
                        <button onClick={() => copyText(myAnswer)}>{t('cg.p2pCopy', '📋 Copia')}</button>
                        <button onClick={async () => { if (!(await shareText(myAnswer))) void copyText(myAnswer); }}>{t('cg.p2pShare', '📤 Condividi')}</button>
                      </div>
                      <div className="muted" style={{ marginTop: 4 }}>{t('cg.p2pWaitingHost', "Quando l'host incolla la tua risposta, il canale si apre da solo.")}</div>
                    </>
                  )}
                </div>
                )}
                {!webrtcSupported() && !lanBeaconSupported() && (
                  <div className="muted" style={{ marginTop: 12 }}>
                    {t('cg.p2pRelayHint', 'Su questo dispositivo il P2P funziona solo via server LAN (relay): usa "🔍 Cerca host sulla rete" qui sopra. Il codice manuale serve solo con WebRTC (browser Chrome/Firefox).')}
                  </div>
                )}
                {!webrtcSupported() && lanBeaconSupported() && (
                  <div className="muted" style={{ marginTop: 12 }}>
                    {t('cg.p2pLanHint', 'Su questa app entri con un tap sugli host LAN trovati qui sopra (WebSocket diretto, niente codici). Il codice manuale serve solo con WebRTC (browser).')}
                  </div>
                )}
              </>
            )}
            {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
          </div>
        </div>
      );
    }
    return (
      <div className="grid" style={{ maxWidth: 560 }}>
        <div className="card">
          <h3><Icon name="globe" candy size={16} /> {t('cg.server', 'Server')}</h3>
          <div className="segmented" style={{ marginBottom: 8 }}>
            <button className={`seg ${(netMode as string) === 'server' ? 'active' : ''}`} onClick={() => switchNetMode('server')}>
              <Icon name="globe" candy size={15} /> {t('cg.remoteServer', 'Server remoto')}
            </button>
            <button className={`seg ${(netMode as string) === 'p2p' ? 'active' : ''}`} onClick={() => switchNetMode('p2p')} title="Campagna direttamente su questo dispositivo (senza server): beacon LAN o codice invito">
              <Icon name="signal" candy size={15} /> {t('cg.p2pHost', 'P2P (host sul mio dispositivo)')}
            </button>
          </div>
          <label>{t('cg.wsUrl', 'Server WebSocket')}</label>
          <div className="row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={onEnter(checkConnection)}
              placeholder="ws://localhost:3001"
              style={{ flex: 1 }}
              list="saved-servers"
            />
            <datalist id="saved-servers">
              {servers.map((s) => <option key={s} value={s} />)}
            </datalist>
            <button onClick={checkConnection} disabled={pingState.status === 'checking'} title={t('cg.checkTitle', 'Controllo manuale della connessione (puoi ripeterlo per aggiornare)')}>
              {pingState.status === 'checking' ? t('cg.ping', 'Ping…') : <><Icon name="wifi" size={13} /> {t('cg.check', 'Verifica connessione')}</>}
            </button>
          </div>
          {pingState.status === 'ok' && <div className="ok" style={{ marginTop: 6 }}>{tf('cg.connected', '✅ Connesso — ping {n} ms', { n: pingState.rtt })}</div>}
          {pingState.status === 'error' && <div className="error" style={{ marginTop: 6 }}>❌ {pingState.message}</div>}
          {servers.length > 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted">{t('cg.savedServers', 'Server salvati:')}</span>
              {servers.map((s) => (
                <button key={s} className="tag" style={{ cursor: 'pointer' }} onClick={() => setUrl(s)}>{s}</button>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3><Icon name="user" candy size={16} /> {t('cg.account', 'Account')}</h3>
          {auth ? (
            <>
              <div className="ok">{t('cg.loggedAsA', '✅ Loggato come')} <b>{auth.username}</b>{tf('cg.loggedAsB', ' — {n} scheda/e in libreria', { n: auth.characters.length })}</div>
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={logout}>{t('cg.logout', 'Esci dall\'account')}</button>
                {auth.role === 'admin' && (
                  <a
                    className="tag"
                    href="/admin"
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'none', padding: '4px 10px', cursor: 'pointer', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                    title={t('cg.adminPanelTitle', 'Apri il pannello admin del server in una nuova scheda (da lì torna qui con il link “App”)')}
                  >
                    🛡️ {t('cg.adminPanel', 'Pannello admin')}
                  </a>
                )}
                {auth.totpEnabled ? (
                  <>
                    <span className="ok">🔐 {t('cg.2faOn', '2FA attiva')}</span>
                    <button
                      onClick={() => {
                        const pw = window.prompt(t('cg.2faDisablePw', 'Password dell\'account per disattivare la 2FA:'));
                        if (pw) void disableTotp(pw);
                      }}
                    >
                      {t('cg.2faOff', 'Disattiva 2FA')}
                    </button>
                  </>
                ) : (
                  <button onClick={() => void setupTotp()} title={t('cg.2faEnableTitle', 'Attiva la verifica in due passaggi con un\'app authenticator (Google Authenticator, Aegis…)')}>
                    🔐 {t('cg.2faEnable', 'Attiva 2FA')}
                  </button>
                )}
              </div>
              {passkeySupported && (
                <div style={{ marginTop: 8 }}>
                  <div className="row">
                    <b>🔑 {t('cg.pkTitle', 'Passkey')}</b>
                    <button onClick={() => void passkeyRegister()} title={t('cg.pkAddTitle', 'Registra una nuova passkey (impronta/PIN del dispositivo o password manager)')}>
                      ➕ {t('cg.pkAdd', 'Aggiungi passkey')}
                    </button>
                    <button onClick={() => void refreshPasskeys()} title={t('cg.refresh', 'Aggiorna')}>
                      <Icon name="refresh" size={13} />
                    </button>
                  </div>
                  {passkeys.length === 0 ? (
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t('cg.pkEmpty', 'Nessuna passkey registrata su questo account')}</div>
                  ) : (
                    passkeys.map((p) => (
                      <div className="row" key={p.id} style={{ marginTop: 4 }}>
                        <span style={{ fontSize: 12 }}>
                          🔑 {p.name}{' '}
                          <span className="muted">
                            ({p.deviceType ?? '?'}{p.backedUp ? ', sync' : ''} · {p.createdAt.slice(0, 10)})
                          </span>
                        </span>
                        <button className="danger" onClick={() => void removePasskey(p.id)}>{t('cg.pkRemove', 'Rimuovi')}</button>
                      </div>
                    ))
                  )}
                </div>
              )}
              {totpSetup && !auth.totpEnabled && (
                <div style={{ marginTop: 8, padding: 10, background: 'var(--panel2)', borderRadius: 8 }}>
                  <b>{t('cg.2faScan', 'Scansiona il QR con l\'app authenticator, poi inserisci il codice a 6 cifre per confermare')}</b>
                  <div className="row" style={{ marginTop: 6, alignItems: 'flex-start', gap: 12 }}>
                    <QrBox text={totpSetup.otpauthUrl} />
                    <div>
                      <div className="muted" style={{ fontSize: 11 }}>{t('cg.2faSecret', 'secret (inserimento manuale):')} <code>{totpSetup.secret}</code></div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{t('cg.2faBackup', 'Codici di backup (salvali: valgono una volta sola):')}</div>
                      <div style={{ columns: 2 }}>
                        {totpSetup.backupCodes.map((b) => <div key={b} style={{ fontSize: 12 }}><code>{b}</code></div>)}
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <input
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      onKeyDown={onEnter(() => void enableTotp(totpCode))}
                      placeholder={t('cg.2faCodePh', 'Codice 6 cifre')}
                      inputMode="numeric"
                      maxLength={6}
                      style={{ width: 130 }}
                    />
                    <button className="primary" disabled={totpCode.trim().length !== 6} onClick={() => void enableTotp(totpCode)}>
                      {t('cg.2faConfirm', 'Conferma e attiva')}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="row">
                <input value={accountName} onChange={(e) => setAccountName(e.target.value)} onKeyDown={onEnter(() => doLogin(accountName, accountPw))} placeholder="Username" style={{ flex: 1 }} />
                <input type="password" value={accountPw} onChange={(e) => setAccountPw(e.target.value)} onKeyDown={onEnter(() => doLogin(accountName, accountPw))} placeholder={t('cg.pwServer', 'Password (verificata dal server)')} style={{ flex: 1 }} />
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={() => doRegister(accountName, accountPw)}>{t('cg.register', 'Registrati')}</button>
                <button className="primary" onClick={() => doLogin(accountName, accountPw)}>{t('cg.login', 'Login')}</button>
              </div>
              {passkeySupported ? (
                <div className="row" style={{ marginTop: 6 }}>
                  <button onClick={() => void passkeyLogin(accountName)} title={t('cg.pkLoginTitle', 'Accedi con una passkey (impronta/PIN del dispositivo o password manager): niente password')}>
                    🔑 {t('cg.pkLogin', 'Accedi con passkey')}
                  </button>
                  {accountName.trim() !== '' && (
                    <span className="muted" style={{ fontSize: 11 }}>{t('cg.pkLoginAs', 'come')} <b>{accountName.trim()}</b></span>
                  )}
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>
                  🔑 {t('cg.pkNeedHttps', 'Le passkey funzionano solo su HTTPS (o localhost): configura https sul server per usarle')}
                </div>
              )}
              {totpPending && (
                <div className="row" style={{ marginTop: 6 }}>
                  <span className="muted">🔐 {t('cg.2faNeed', '2FA attiva su questo account: inserisci il codice dell\'app authenticator')}</span>
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    onKeyDown={onEnter(() => doLoginTotp(totpPending, accountPw, totpCode))}
                    placeholder={t('cg.2faCodePh', 'Codice 6 cifre')}
                    inputMode="numeric"
                    maxLength={6}
                    style={{ width: 130 }}
                    autoFocus
                  />
                  <button className="primary" disabled={totpCode.trim().length !== 6} onClick={() => doLoginTotp(totpPending, accountPw, totpCode)}>{t('cg.login', 'Login')}</button>
                  <button
                    disabled={totpCode.trim().length < 6}
                    onClick={() => doLoginTotpBackup(totpPending, accountPw, totpCode)}
                    title={t('cg.2faBackupLoginTitle', 'Usa un codice di backup (vale una volta sola)')}
                  >
                    {t('cg.2faBackupLogin', 'Usa codice di backup')}
                  </button>
                </div>
              )}
              {notice && <div className="ok" style={{ marginTop: 6 }}>ℹ️ {notice}</div>}
              <div className="muted" style={{ marginTop: 6 }}>
                {t('cg.regNote', 'La registrazione crea una richiesta che l\'admin approva dal pannello /admin; la password è verificata lato server (hash sha256, mai in chiaro).')}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h3><Icon name="swords" candy size={16} /> {t('cg.campaign', 'Campagna multiplayer')}</h3>
          <div className="segmented" style={{ marginBottom: 8 }}>
            <button className={`seg ${mode === 'create' ? 'active' : ''}`} onClick={() => setMode('create')}><Icon name="plus" candy size={14} /> {t('cg.create', 'Crea campagna (master)')}</button>
            <button className={`seg ${mode === 'join' ? 'active' : ''}`} onClick={() => setMode('join')}><Icon name="door" candy size={14} /> {t('cg.join', 'Unisciti a una campagna')}</button>
          </div>
          <label>{t('cg.yourName', 'Il tuo nome')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter(() => { setError(''); connect({ mode, password, campaignName, joinId, asMaster }); })} placeholder="Eroe" />
          {mode === 'create' && (
            <>
              <label>{t('cg.campaignName', 'Nome campagna')}</label>
              <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} onKeyDown={onEnter(() => { setError(''); connect({ mode, password, campaignName, joinId, asMaster }); })} placeholder="La tomba perduta" />
            </>
          )}
          {mode === 'join' && (
            <>
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={refreshCampaignList}><Icon name="refresh" size={13} /> {t('cg.refreshList', 'Aggiorna lista dal server')}</button>
              </div>
              {savedCampaigns.length > 0 && (
                <>
                  <label>{t('cg.savedCampaigns', 'Campagne salvate')}</label>
                  <select
                    value={joinId}
                    onChange={(e) => {
                      setJoinId(e.target.value);
                      const sc = savedCampaigns.find((x) => x.id === e.target.value);
                      if (sc && sc.server !== url) setUrl(sc.server);
                    }}
                  >
                    <option value="">{t('cg.pickSaved', '— scegli una campagna salvata —')}</option>
                    {savedCampaigns.map((c) => <option key={c.server + c.id} value={c.id}>{c.name} ({c.id}) @ {c.server}</option>)}
                  </select>
                </>
              )}
              {campaignList.length > 0 && (
                <>
                  <label>{t('cg.onServer', 'Campagne sul server')}</label>
                  <select value={joinId} onChange={(e) => setJoinId(e.target.value)}>
                    <option value="">{t('cg.pick', '— scegli campagna —')}</option>
                    {campaignList.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id}, {c.players} giocatori)</option>)}
                  </select>
                </>
              )}
              <label>{t('cg.idManual', 'ID campagna (manuale)')}</label>
              <input value={joinId} onChange={(e) => setJoinId(e.target.value)} onKeyDown={onEnter(() => { setError(''); connect({ mode, password, campaignName, joinId, asMaster }); })} placeholder={t('cg.idPh', 'id a 8 caratteri')} />
              <label className="row" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={asMaster} onChange={(e) => setAsMaster(e.target.checked)} style={{ width: 'auto' }} />
                <span>{tf('cg.asMaster', 'Entra come master (serve la password della campagna; possibile solo se nessun master è collegato)', {})}</span>
              </label>
            </>
          )}
          <label>{t('cg.password', 'Password campagna')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter(() => { setError(''); connect({ mode, password, campaignName, joinId, asMaster }); })} />
          {error && (
            <div className="error row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>{error}</span>
              <button onClick={() => setError('')} aria-label={t('cg.errClose', 'Chiudi errore')} title={t('cg.errClose', 'Chiudi errore')} style={{ flexShrink: 0 }}>
                <Icon name="x" size={12} />
              </button>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={conn.phase === 'connecting'}
              onClick={() => { setError(''); connect({ mode, password, campaignName, joinId, asMaster }); }}
            >
              {conn.phase === 'connecting' ? t('cg.connecting', 'Connessione...') : <><Icon name="play" candy size={14} /> {mode === 'create' ? t('cg.createEnter', 'Crea e entra') : t('cg.enter', 'Entra')}</>}
            </button>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            {t('cg.serverHint', 'Avvia il server con npm run server (porta 3001): serve la web app e il WebSocket. Pannello admin del server: /admin. In modalità "Crea" diventi il master.')}
          </div>
        </div>
      </div>
    );
  }

  const { campaign, you } = conn;
  const combat = campaign.combat;
  const partyLevel = (() => {
    const lvls = campaign.players.map((p) => (campaign.characters[p.id] ? totalLevel(campaign.characters[p.id]) : 0)).filter((l) => l > 0);
    return lvls.length ? Math.max(1, Math.round(lvls.reduce((a, b) => a + b, 0) / lvls.length)) : 1;
  })();
  const cur = combat?.combatants[combat.turnIndex];
  const myCharId = char?.id;
  const isMyTurn = !!(combat && cur && cur.isPlayer && cur.id === myCharId);
  const isMaster = you.role === 'master';

  return (
    <div className="grid">
      <div className="card">
        <h3>🌐 {campaign.name} <span className="tag custom">{you.role === 'master' ? t('cg.master', 'Master') : t('cg.player', 'Giocatore')}</span> <span className="muted">id {campaign.id}</span></h3>
        <div className="row">
          <b>{t('cg.players', 'Giocatori:')}</b>
          {campaign.players.map((p) => (
            <span key={p.id} className={`tag ${p.id === you.id ? 'custom' : ''}`} title={p.online === false ? t('cg.offlineTitle', 'Disconnesso: in attesa di riconnessione automatica') : undefined}>
              {p.name}{p.role === 'master' ? ' 👑' : ''}{p.online === false ? ` 🔌 ${t('cg.offline', 'disconnesso')}` : ''}{campaign.characters[p.id] ? ` — ${campaign.characters[p.id].name}` : ` ${t('cg.withoutSheet', '(senza scheda)')}`}
            </span>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={checkConnection} disabled={pingState.status === 'checking'} title="Controllo manuale (ripetibile per aggiornare)">
            {pingState.status === 'checking' ? t('cg.ping', 'Ping…') : t('cg.check', '🔌 Verifica connessione')}
          </button>
          {pingState.status === 'ok' && <span className="ok">✅ {pingState.rtt} ms</span>}
          {pingState.status === 'error' && <span className="error">❌ {pingState.message}</span>}
          {isMaster && (
            <button
              className="danger"
              onClick={() => { if (confirm(tf('cg.deleteConfirm', 'Eliminare definitivamente la campagna "{name}" ({id})? Tutti i partecipanti verranno disconnessi.', { name: campaign.name, id: campaign.id }))) act({ kind: 'deleteCampaign' }); }}
            >
              {t('cg.deleteCampaign', '🗑️ Elimina campagna')}
            </button>
          )}
          <button onClick={exitP2P}>{t('cg.exit', 'Esci')}</button>
          {char?.concentrationSpellId && (
            <span className="tag custom">{tf('cg.concChip', '🎯 {name}', { name: reg.spells.get(char.concentrationSpellId)?.name ?? char.concentrationSpellId })}
              <button style={{ padding: '0 5px', marginLeft: 4 }} title={t('cg.dropConc', 'Interrompi la concentrazione')} onClick={() => act({ kind: 'dropConcentration' })}>✕</button>
            </span>
          )}
        </div>
        {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
      </div>

      {hostRef.current && isMaster && (hostMode === 'relay' || hostMode === 'lan') && (
        <div className="card">
          <h3>{hostMode === 'lan' ? t('cg.addPlayersLan', '🖥️ Aggiungi giocatori (host su questa rete)') : t('cg.addPlayers', '📨 Aggiungi giocatori (P2P relay)')}</h3>
          {hostMode === 'lan' && beaconInfo && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              {t('cg.lanFirewallHint', 'Se gli altri non ti vedono: stessa WiFi/sottorete, firewall aperto sulla porta 3177 (Windows: Impostazioni → Firewall → consenti 5e Manager), host avviato.')}
            </div>
          )}
          {hostMode === 'lan' && beaconInfo && (
            <>
              <div className="ok" style={{ marginBottom: 8 }}>
                {tf('cg.lanBeaconOn', 'In onda su ws://{ip}:{port} — i giocatori sulla stessa rete ti trovano con "Scansiona rete" e entrano con un tap.', { ip: beaconInfo.ip, port: beaconInfo.port })}
              </div>
              <div className="row" style={{ marginBottom: 8, alignItems: 'flex-start' }}>
                <QrBox text={`5ELAN:ws://${beaconInfo.ip}:${beaconInfo.port}`} />
                <div className="muted" style={{ fontSize: 12 }}>
                  {t('cg.lanQrHint', 'Fallback sicuro: gli altri scansionano questo QR (o copiano l\'indirizzo) e entrano direttamente, anche se la scansione automatica non trova nulla.')}
                  <div style={{ marginTop: 4 }}><code>ws://{beaconInfo.ip}:{beaconInfo.port}</code></div>
                </div>
              </div>
              {beaconInfo.ips && beaconInfo.ips.length > 1 && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {tf('cg.lanMultiIp', 'Questo dispositivo ha più IP (WiFi/hotspot): se ws://{ip} non risponde dagli altri dispositivi, prova:', { ip: beaconInfo.ip })}
                  {beaconInfo.ips.filter((x) => x !== beaconInfo.ip).map((x) => (
                    <div key={x} style={{ marginTop: 2 }}><code>ws://{x}:{beaconInfo.port}</code></div>
                  ))}
                </div>
              )}
            </>
          )}
          {(hostMode === 'relay' || hostMode === 'lan') && (discState === 'on' ? (
            <div className="ok" style={{ marginBottom: 8 }}>
              📡 {tf('cg.p2pAnnouncedOn', 'Annunciato su {url}', { url })} — {t('cg.p2pRelayPlayersHint', 'chi cerca host sulla rete ti vede e entra con un click (via server, oltre al QR/indirizzo LAN).')}
            </div>
          ) : (
            <div className="row" style={{ marginBottom: 8 }}>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={onEnter(() => startAnnounce())}
                placeholder="ws://<ip-server>:3001"
                style={{ flex: 1 }}
              />
              <button className="primary" onClick={() => startAnnounce()}>{t('cg.p2pAnnounceNow', '📡 Annuncia su server LAN')}</button>
            </div>
          ))}
          {(hostMode === 'relay' || hostMode === 'lan') && (
            <>
              <div className="row" style={{ marginBottom: 4 }}>
                <button
                  onClick={() => { if (discState !== 'on') void startAnnounce(undefined, true); else newShortInviteCode(); }}
                  title={t('cg.p2pShortCodeTitle', 'Codice breve XXXX-XXXX relayato dal server: il giocatore lo digita (o scansiona il QR) e si unisce da solo, senza incollare l\'invito SDP')}
                >
                  <Icon name="key" candy size={14} /> {t('cg.p2pNewShortCode', '🔑 Codice invito breve')}
                </button>
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {t('cg.p2pAnnounceExplain', 'Annunciarsi su un server 5emanager (es. quello Docker su questa rete, ws://<ip>:3001) registra lì il codice breve: chi può raggiungere quel server entra digitando il codice, anche se non è sulla tua stessa WiFi. In LAN non serve: basta il QR/indirizzo qui sopra.')}
              </div>
            </>
          )}
          {hostNotice && <div className="ok" style={{ marginTop: 8 }}>{hostNotice}</div>}
          {inviteCode && (hostMode === 'lan' || discState === 'on') && (
            <div className="row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
              <QrBox text={`${CODE_PREFIX}${inviteCode}`} />
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: 18, letterSpacing: 2 }}><b>{inviteCode}</b></div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {t('cg.p2pShortCodeHint', "Il giocatore digita questo codice (o scansiona il QR col telefono) e si unisce da solo: niente codici SDP lunghi da incollare. Valido finché resti annunciato sul server.")}
                </div>
              </div>
            </div>
          )}
          {pendingJoins.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <b>{t('cg.p2pPending', 'Richieste di unione in attesa:')}</b>
              {pendingJoins.map((pj) => (
                <div key={pj.from} className="row" style={{ marginTop: 4 }}>
                  <span className="tag custom"><Icon name="users" size={12} /> {pj.name}</span>
                  <button
                    className="primary"
                    onClick={() => {
                      (hostRef.current as P2PRelayHost | P2PLanHost).acceptJoin(pj.from);
                      setPendingJoins((p) => p.filter((x) => x.from !== pj.from));
                      setHostNotice('✅ ' + t('cg.p2pPlayerConnected', 'Giocatore collegato!'));
                    }}
                  >
                    <Icon name="check" candy size={13} /> {t('cg.p2pAccept', 'Accetta')}
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      (hostRef.current as P2PRelayHost | P2PLanHost).rejectJoin(pj.from);
                      setPendingJoins((p) => p.filter((x) => x.from !== pj.from));
                    }}
                  >
                    <Icon name="x" candy size={13} /> {t('cg.p2pReject', 'Rifiuta')}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="muted" style={{ marginTop: 6 }}>
            {tf('cg.peersConnected', 'Giocatori connessi: {list}', { list: campaign.players.map((p) => p.name).join(', ') || t('cg.onlyYou', 'solo te') })}
          </div>
        </div>
      )}

      {hostRef.current && isMaster && hostMode === 'rtc' && (
        <div className="card">
          <h3>{t('cg.addPlayers', '📨 Aggiungi giocatori (P2P)')}</h3>
          {discState === 'on' && (
            <div className="ok" style={{ marginBottom: 8 }}>
              {tf('cg.p2pAnnounced', '📡 Annunciato su {url} come "{name}": chi cerca host su questa rete ti vede e si unisce con un click.', { url, name: campaignName || name || campaign.name })}
            </div>
          )}
          {hostNotice && <div className="ok" style={{ marginBottom: 8 }}>{hostNotice}</div>}
          <div className="row">
            <button className="primary" onClick={newInvite}>{t('cg.p2pNewInvite', '➕ Nuovo codice invito')}</button>
            <button onClick={() => { if (discState !== 'on') void startAnnounce(undefined, true); else newShortInviteCode(); }} title={t('cg.p2pShortCodeTitle', 'Codice breve XXXX-XXXX relayato dal server: il giocatore lo digita (o scansiona il QR) e si unisce da solo, senza incollare l\'invito SDP')}>
              <Icon name="key" candy size={14} /> {t('cg.p2pNewShortCode', '🔑 Codice invito breve')}
            </button>
            {discState !== 'on' && (
              <button onClick={() => startAnnounce()} title={t('cg.p2pAnnounceTitle', 'Annuncia questo host su un server LAN (relay solo dei codici, il gioco resta P2P diretto)')}>
                {t('cg.p2pAnnounceNow', '📡 Annuncia su server LAN')}
              </button>
            )}
          </div>
          {inviteCode && discState === 'on' && (
            <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
              <QrBox text={`${CODE_PREFIX}${inviteCode}`} />
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: 22, letterSpacing: 2 }}><b>{inviteCode}</b></div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {t('cg.p2pShortCodeHint', "Il giocatore digita questo codice (o scansiona il QR col telefono) e si unisce da solo: niente codici SDP lunghi da incollare. Valido finché resti annunciato sul server.")}
                </div>
              </div>
            </div>
          )}
          {invite && (
            <div style={{ marginTop: 10 }}>
              <label>{t('cg.p2pInviteCode', 'Codice invito da dare al giocatore (copia, condividi o mostra il QR):')}</label>
              <div className="row" style={{ marginTop: 4, alignItems: 'flex-start' }}>
                <textarea readOnly rows={3} value={invite.code} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                  <QrBox text={invite.code} />
                  <div className="row">
                    <button onClick={() => copyText(invite.code)}>{t('cg.p2pCopy', '📋 Copia')}</button>
                    <button onClick={async () => { if (!(await shareText(invite.code))) void copyText(invite.code); }}>{t('cg.p2pShare', '📤 Condividi')}</button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <label style={{ marginTop: 10 }}>{t('cg.p2pPasteAnswer', 'Incolla qui la risposta del giocatore:')}</label>
          <textarea rows={3} value={joinerAnswer} onChange={(e) => setJoinerAnswer(e.target.value)} style={{ width: '100%' }} />
          <div style={{ marginTop: 6 }}>
            <button className="primary" disabled={!joinerAnswer.trim()} onClick={acceptJoiner}>{t('cg.p2pConnectPlayer', '✅ Collega giocatore')}</button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            {tf('cg.peersConnected', 'Giocatori connessi: {list}', { list: campaign.players.map((p) => p.name).join(', ') || t('cg.onlyYou', 'solo te') })}
          </div>
        </div>
      )}

      <div className="card">
        <h3>📤 {t('cg.pickSheet', '🗂 Scegli la scheda da usare in campagna')}</h3>
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
              {t('cg.loadLocal', 'Carica scheda locale')}
            </button>
          </div>
        )}
        {auth && auth.characters.length > 0 && (
          <div className="row" style={{ marginTop: 6 }}>
            <select value={accPick} onChange={(e) => setAccPick(e.target.value)}>
              <option value="">{tf('cg.fromAccount', '— scheda dalla libreria di {u} —', { u: auth.username })}</option>
              {auth.characters.map((c) => <option key={c.id} value={c.id}>{c.name} (liv {totalLevel(c)})</option>)}
            </select>
            <button disabled={!accPick} onClick={() => act({ kind: 'useCharacter', characterId: accPick })}>{t('cg.loadAccount', 'Carica da account')}</button>
          </div>
        )}
        {auth && char && (
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={() => act({ kind: 'saveCharacter', character: char })}>
              {tf('cg.saveToAccount', '💾 Salva "{name}" nella libreria dell\'account ({u})', { name: char.name, u: auth.username })}
            </button>
          </div>
        )}
        {!auth && <div className="muted" style={{ marginTop: 6 }}>{t('cg.noAuthHint', 'La connessione resta attiva anche cambiando tab. Esci e fai login dall\'account per salvare le schede sul server e riutilizzarle in altre campagne.')}</div>}
      </div>

      {isMaster && (
        <div className="card">
          <h3>{t('cg.dmScreen', '🖥 Schermo del master')}</h3>
          <table>
            <thead>
              <tr><th>{t('cg.thPlayer', 'Giocatore')}</th><th>{t('cg.thChar', 'PG')}</th><th>{t('cg.thLevel', 'Liv')}</th><th>{t('cg.thHp', 'PF')}</th><th>{t('cg.thAc', 'CA')}</th><th>{t('cg.thPassPerc', 'Percez. passiva')}</th><th>{t('cg.thPassIns', 'Intuizione passiva')}</th><th>{t('cg.thCond', 'Condizioni')}</th></tr>
            </thead>
            <tbody>
              {campaign.players.map((p) => {
                const ch = campaign.characters[p.id];
                if (!ch) return <tr key={p.id}><td>{p.name}{p.online === false ? ` 🔌 ${t('cg.offline', 'disconnesso')}` : ''}</td><td className="muted" colSpan={7}>{t('cg.noSheet', 'senza scheda')}</td></tr>;
                return (
                  <tr key={p.id}>
                    <td>
                      {p.name}{p.role === 'master' ? ' 👑' : ''}{p.online === false ? ` 🔌 ${t('cg.offline', 'disconnesso')}` : ''}
                      {ch && <button style={{ marginLeft: 6, padding: '0 6px' }} title={t('cg.seeFullTitle', 'Vedi la scheda completa di questo giocatore')} onClick={() => setViewChar(ch, p.name)}>👁</button>}
                    </td>
                    <td>{ch.name}</td>
                    <td>{totalLevel(ch)}</td>
                    <td>{ch.hp.current}/{maxHp(ch, reg)}</td>
                    <td>{armorClass(ch, reg).ac}</td>
                    <td>{passivePerception(ch)}</td>
                    <td>{passiveInsight(ch)}</td>
                    <td>{ch.conditions.map((cd) => <span key={cd} className="tag custom">{CONDITIONS.find((x) => x.id === cd)?.name ?? cd}</span>)}{ch.exhaustion > 0 && <span className="tag custom">{tf('cg.exhaustionTag', 'esaurimento {n}', { n: ch.exhaustion })}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isMaster && (
        <div className="card">
          <h3>{t('cg.masterPanel', '👑 Pannello master — schede e status dei giocatori')}</h3>
          {campaign.players.length === 0 && <div className="muted">Nessun giocatore collegato.</div>}
          {campaign.players.map((p) => {
            const ch = campaign.characters[p.id];
            return (
              <details key={p.id} style={{ marginBottom: 6 }}>
                <summary style={{ cursor: 'pointer' }}>
                  <b>{p.name}</b> {p.role === 'master' ? '👑' : ''}{p.online === false ? ` 🔌 ${t('cg.offline', 'disconnesso')}` : ''}
                  {ch ? (
                    <span className="row" style={{ display: 'inline-flex', marginLeft: 8 }}>
                      <span className="tag custom">{ch.name} — liv {totalLevel(ch)}</span>
                      <span className="tag">PF {ch.hp.current}/{maxHp(ch, reg)}</span>
                      <span className="tag">CA {armorClass(ch, reg).ac}</span>
                      <span className="tag">XP {ch.xp}</span>
                      {ch.conditions.map((cd) => <span key={cd} className="tag custom">{CONDITIONS.find((x) => x.id === cd)?.name ?? cd}</span>)}
                    </span>
                  ) : <span className="muted"> {t('cg.withoutSheet', '(senza scheda)')}</span>}
                  {p.role !== 'master' && (
                    <button className="danger" style={{ marginLeft: 8 }} title={t('cg.kickTitle', 'Espelli questo giocatore dalla campagna (lo disconnette subito)')}
                      onClick={() => { if (window.confirm(tf('cg.kickConfirm', 'Espellere {name} dalla campagna?', { name: p.name }))) act({ kind: 'kickPlayer', playerId: p.id }); }}>
                      🚫 {t('cg.kick', 'Espelli')}
                    </button>
                  )}
                </summary>
                {ch && (
                  <div style={{ marginTop: 6 }}>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <button className="primary" onClick={() => setViewChar(ch, p.name)}>{t('cg.seeFull', '👁 vedi scheda completa')}</button>
                      <button className="danger" onClick={() => act({ kind: 'masterDamage', playerId: p.id, amount: 5 })}>🔒 {t('cg.m5', '🔫 −5 PF')}</button>
                      <button onClick={() => act({ kind: 'masterHeal', playerId: p.id, amount: 5 })}>🔒 {t('cg.p5', '🔫 +5 PF')}</button>
                      <button onClick={() => act({ kind: 'masterAddXp', playerId: p.id, amount: 300 })}>🔒 {t('cg.xp300', '🔫 +300 XP')}</button>
                      <select value="" onChange={(e) => { if (e.target.value) act({ kind: 'masterSetCondition', playerId: p.id, conditionId: e.target.value, on: true }); }}>
                        <option value="">{t('cg.addCond', '🔫 + condizione…')}</option>
                        {CONDITIONS.map((cd) => <option key={cd.id} value={cd.id}>{cd.name}</option>)}
                      </select>
                      <select value="" onChange={(e) => { if (e.target.value) act({ kind: 'masterSetCondition', playerId: p.id, conditionId: e.target.value, on: false }); }}>
                        <option value="">{t('cg.remCond', '🔫 − condizione…')}</option>
                        {ch.conditions.map((cd) => <option key={cd} value={cd}>{CONDITIONS.find((x) => x.id === cd)?.name ?? cd}</option>)}
                      </select>
                    </div>
                    <SheetFull ch={ch} reg={reg} />
                  </div>
                )}
              </details>
            );
          })}
          <div className="muted" style={{ marginTop: 4 }}>{t('cg.secretNote', 'Le azioni 🔫 sono applicate di nascosto: non finiscono nel log pubblico del combattimento.')}</div>
        </div>
      )}

      {isMaster && (
        <div className="card">
          <h3>{t('cg.gen', '🎲 Generatore (master)')}</h3>
          <div className="muted" style={{ marginBottom: 6 }}>{tf('cg.genTier', 'tier {t} (liv {lvl} medio party)', { t: partyLevel <= 4 ? 'Livello 1-4' : partyLevel <= 10 ? 'Livello 5-10' : partyLevel <= 16 ? 'Livello 11-16' : 'Livello 17-20', lvl: partyLevel })}</div>
          <div className="row">
            <button onClick={() => setGenResult({ kind: 'name', text: randomName(RANDOM_DATA) })}>{t('cg.genName', 'Nome')}</button>
            <button onClick={() => { const e = rollEncounter(RANDOM_DATA, partyLevel); setGenResult({ kind: 'enc', text: `${e.name} — XP ${e.xp}`, enemies: e.enemies, xp: e.xp }); }}>{t('cg.genEnc', 'Incontro casuale')}</button>
            <button onClick={() => { const tr = rollTreasure(RANDOM_DATA, partyLevel); setGenResult({ kind: 'tre', text: tr.text, currency: tr.currency, items: tr.items }); }}>{t('cg.genTre', 'Tesoro casuale')}</button>
          </div>
          {genResult && (
            <div style={{ marginTop: 8, padding: 8, background: 'var(--panel2)', borderRadius: 8 }}>
              <b>{genResult.text}</b>
              {genResult.enemies && (
                <div className="row" style={{ marginTop: 6 }}>
                  {genResult.enemies.map((e, i) => (
                    <span key={i} className="tag custom">{reg.enemies.get(e.enemyId)?.name ?? e.enemyId} x{e.count}</span>
                  ))}
                  {combat && (
                    <button className="primary" onClick={() => { for (const e of genResult.enemies ?? []) for (let i = 0; i < e.count; i++) act({ kind: 'addEnemy', enemyId: e.enemyId, count: 1 }); }}>
                      {t('cg.genAddEnemies', '⚔️ Aggiungi nemici al combattimento')}
                    </button>
                  )}
                  {!combat && <span className="muted">({t('cg.startCombat', 'Avvio combattimento')}?)</span>}
                </div>
              )}
              {(genResult.currency || genResult.items?.length) && (
                <div className="row" style={{ marginTop: 6 }}>
                  <button onClick={() => {
                    if (genResult.currency) act({ kind: 'groupAddCurrency', amount: genResult.currency });
                    for (const it of genResult.items ?? []) act({ kind: 'groupAddItem', item: { name: it.name, quantity: it.quantity ?? 1, valueGp: it.valueGp, rarity: it.rarity, magic: it.magic ?? false } });
                    setGenResult(null);
                  }}>
                    {t('cg.genToGroup', '🎒 Metti nel gruppo / tesoreria')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h3>{t('cg.group', '🎒 Inventario di gruppo e tesoreria')}</h3>
        <div className="muted">{tf('cg.treasury', 'Tesoreria di gruppo: {gp} mo · {sp} ma · {ep} me · {cp} mr · {pp} mp', { gp: campaign.groupCurrency.gp, sp: campaign.groupCurrency.sp, ep: campaign.groupCurrency.ep, cp: campaign.groupCurrency.cp, pp: campaign.groupCurrency.pp })}</div>
        {isMaster && (
          <div className="row" style={{ marginTop: 6 }}>
            <input type="number" min={0} value={gGp} onChange={(e) => setGGp(Number(e.target.value))} style={{ width: 80 }} />
            <button onClick={() => { if (gGp > 0) act({ kind: 'groupAddCurrency', amount: { gp: gGp } }); setGGp(0); }}>{t('inv.addGold', 'Aggiungi MO')}</button>
            <input type="number" value={xpAllAmt} onChange={(e) => setXpAllAmt(Number(e.target.value))} style={{ width: 80 }} />
            <button className="primary" onClick={() => act({ kind: 'masterAddXpAll', amount: xpAllAmt })}>
              {tf('cg.xpAll', '⭐ +{n} XP a tutta la party', { n: xpAllAmt })}
            </button>
          </div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <input placeholder={t('cg.thItem', 'Oggetto')} value={gName} onChange={(e) => setGName(e.target.value)} style={{ width: 160 }} />
          <input type="number" min={1} value={gQty} onChange={(e) => setGQty(Number(e.target.value))} title={t('cg.gQty', 'Qtà')} style={{ width: 60 }} />
          <input type="number" min={0} value={gValue} onChange={(e) => setGValue(e.target.value)} title={t('cg.gValue', 'Valore MO')} placeholder="MO" style={{ width: 70 }} />
          <select value={gRarity} onChange={(e) => setGRarity(e.target.value as ItemRarity | '')} style={{ width: 'auto' }}>
            <option value="">{t('inv.rarity', 'Rarità')}</option>
            {(['common', 'uncommon', 'rare', 'veryRare', 'legendary'] as ItemRarity[]).map((r) => <option key={r} value={r}>{t('inv.r.' + r, r)}</option>)}
          </select>
          <label className="row" style={{ margin: 0 }}>
            <input type="checkbox" checked={gMagic} onChange={(e) => setGMagic(e.target.checked)} style={{ width: 'auto' }} /> {t('inv.magic', 'Oggetto magico')}
          </label>
          <button
            disabled={!gName.trim()}
            onClick={() => {
              act({ kind: 'groupAddItem', item: { name: gName.trim(), quantity: gQty, valueGp: gValue ? Number(gValue) : undefined, rarity: gRarity || undefined, magic: gMagic } });
              setGName(''); setGQty(1); setGValue(''); setGRarity(''); setGMagic(false);
            }}
          >
            {t('cg.gAdd', 'Aggiungi al gruppo')}
          </button>
        </div>
        {campaign.groupInventory.length === 0 && <div className="muted" style={{ marginTop: 8 }}>{t('cg.groupEmpty', 'Il gruppo non ha ancora oggetti.')}</div>}
        {campaign.groupInventory.length > 0 && (
          <table style={{ marginTop: 8 }}>
            <tbody>
              {campaign.groupInventory.map((it) => (
                <tr key={it.id}>
                  <td>{it.name}{it.quantity > 1 ? ` x${it.quantity}` : ''} {it.magic && '✨'}{it.rarity && <span className="tag custom">{t('inv.r.' + it.rarity, it.rarity)}</span>}</td>
                  <td className="muted">{it.valueGp ? `${it.valueGp * it.quantity} mo` : ''}</td>
                  <td>
                    {isMaster && (
                      <span className="row">
                        <select value={giveTarget} onChange={(e) => setGiveTarget(e.target.value)} style={{ width: 110 }}>
                          <option value="">{t('cg.gNoPlayer', '— giocatore —')}</option>
                          {campaign.players.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                        </select>
                        <button
                          disabled={!giveTarget}
                          title={t('cg.gGiveTitle', 'Assegna questo oggetto a un giocatore')}
                          onClick={() => { act({ kind: 'groupGiveItem', itemId: it.id, playerId: giveTarget }); setGiveTarget(''); }}
                        >
                          {t('cg.gGive', 'dai a…')}
                        </button>
                        <button className="danger" title={t('cg.gRemoveTitle', 'Rimuovi dal gruppo')} onClick={() => act({ kind: 'groupRemoveItem', itemId: it.id })}>✕</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>{t('cg.notes', '📝 Note di sessione (condivise)')}</h3>
        <textarea
          rows={4}
          value={noteText || campaign.notes}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder={t('cg.notesPh', 'Appunti visibili a tutta la campagna…')}
          readOnly={!isMaster}
          style={{ width: '100%' }}
        />
        {isMaster && (
          <div style={{ marginTop: 6 }}>
            <button className="primary" onClick={() => { act({ kind: 'setCampaignNote', text: noteText || campaign.notes }); }}>{t('cg.notesSave', 'Salva note')}</button>
          </div>
        )}
      </div>

      {isMaster && !combat && (
        <div className="card">
          <h3>👑 {t('cg.startCombat', 'Avvio combattimento')}</h3>
          <div className="row">
            <button className="primary" onClick={() => act({ kind: 'startCombat' })} disabled={Object.keys(campaign.characters).length === 0}>
              {t('cg.startCombatBtn', '⚔️ Avvia combattimento')}
            </button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>{t('cg.startCombatHint', 'I giocatori devono aver caricato la scheda. Il combattimento parte con tutti i PG.')}</div>
        </div>
      )}

      {combat && (
        <div className="card">
          <h3>⚔️ {tf('cg.combat', '⚔️ Combattimento — Round {n}', { n: combat.round })} {cur && <span className="tag custom"> {tf('cb.turn', 'turno: {name}', { name: cur.name })}</span>}
            {isMyTurn && <span className="tag my-turn-tag">⚔️ {t('cg.myTurn', 'È il tuo turno!')}</span>}
          </h3>
          <div className="row" style={{ marginBottom: 8 }}>
            <button onClick={toggleSound} title={soundOn ? t('cg.soundOff', 'Disattiva il suono di turno') : t('cg.soundOn', 'Attiva il suono quando inizia il tuo turno')}>
              {soundOn ? '🔔' : '🔕'} {t('cg.sound', 'suono turno')}
            </button>
            {isMaster && (
              <>
                <select value={enemyId} onChange={(e) => setEnemyId(e.target.value)} style={{ width: 140 }}>
                  <option value="">{t('cg.addEnemy', '+ nemico...')}</option>
                  {[...reg.enemies.values()].map((e) => <option key={e.id} value={e.id}>{e.name} (CA {e.ac}, {e.hp} PF)</option>)}
                </select>
                <button disabled={!enemyId} onClick={() => { act({ kind: 'addEnemy', enemyId, count: 1 }); setEnemyId(''); }}>{t('cg.add', 'Aggiungi')}</button>
                <button onClick={() => act({ kind: 'rollInitiative' })}>{t('cg.initiative', '🎲 Initiative')}</button>
                <button className="danger" onClick={() => act({ kind: 'endCombat' })}>{t('cg.endCombat', 'Fine combattimento')}</button>
              </>
            )}
            {(isMyTurn || isMaster) && (
              <button className="primary" onClick={() => act({ kind: 'nextTurn' })}>{t('cg.next', 'Turno ▶')}</button>
            )}
            <button onClick={() => setShowTpl((v) => !v)} title={t('cb.tpl', '📐 template')}>{t('cb.tpl', '📐 template')}</button>
            <button
              title={t('cg.exportLog', '💾 Esporta log')}
              onClick={() => {
                const blob = new Blob([combat.log.join('\n')], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${campaign.name.replace(/\s+/g, '-')}-log.txt`;
                a.click();
              }}
            >
              {t('cg.exportLog', '💾 Esporta log')}
            </button>
            <span className="tag" style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }} title={t('cg.timerTitle', 'Timer del turno (locale)')}>
              ⏱ {Math.floor(timerLeft / 60)}:{String(timerLeft % 60).padStart(2, '0')}
            </span>
            <input
              type="number" min={5} step={5} value={timerSec}
              onChange={(e) => { const v = Math.max(5, Number(e.target.value)); setTimerSec(v); setTimerLeft(v); }}
              style={{ width: 56 }}
              title={t('cg.timerSec', 'Secondi per turno')}
            />
            <button onClick={() => setTimerOn(true)} disabled={timerOn} title={t('cg.timerStart', 'Avvia timer')}>▶</button>
            <button onClick={() => setTimerOn(false)} disabled={!timerOn} title={t('cg.timerPause', 'Pausa')}>⏸</button>
            <button onClick={() => { setTimerOn(false); setTimerLeft(timerSec); }} title={t('cg.timerReset', 'Reset timer')}>↺</button>
          </div>
          {showTpl && (isMaster || isMyTurn) && (
            <div className="row" style={{ marginBottom: 8 }}>
              <select value={tplShape} onChange={(e) => setTplShape(e.target.value as TemplateShape)} style={{ width: 'auto' }}>
                <option value="cone">{t('cb.cone', 'cono')}</option>
                <option value="sphere">{t('cb.sphere', 'sfera')}</option>
                <option value="line">{t('cb.line', 'linea')}</option>
                <option value="cube">{t('cb.cube', 'cubo')}</option>
              </select>
              <label className="row" style={{ margin: 0, fontSize: 12 }}>
                {t('cb.tplSize', 'misura (ft)')}
                <input type="number" min={5} step={5} value={tplSize} onChange={(e) => setTplSize(Number(e.target.value))} style={{ width: 60 }} />
              </label>
              {tplShape === 'line' && (
                <label className="row" style={{ margin: 0, fontSize: 12 }}>
                  {t('cb.tplWidth', 'larghezza (ft)')}
                  <input type="number" min={5} step={5} value={tplWidth} onChange={(e) => setTplWidth(Number(e.target.value))} style={{ width: 60 }} />
                </label>
              )}
              <button
                disabled={!cur}
                onClick={() => act({ kind: 'setTemplate', template: { shape: tplShape, sizeFt: tplSize, widthFt: tplShape === 'line' ? tplWidth : undefined, originId: cur?.id } })}
              >
                {t('cb.tplPlace', 'Piazza sul turno corrente')}
              </button>
              {combat.template && (
                <button className="danger" onClick={() => act({ kind: 'clearTemplate' })}>{t('cb.tplClear', 'Rimuovi')}</button>
              )}
            </div>
          )}
          {combat.template && (
            <div style={{ marginBottom: 10, maxWidth: 420 }}>
              <TemplateView tpl={combat.template} />
            </div>
          )}

          <table>
            <thead>
              <tr><th>{t('cg.thInit', 'Init')}</th><th>{t('cg.thCombatant', 'Combattente')}</th><th>{t('cg.thHp', 'PF')}</th><th>{t('cg.thAc', 'CA')}</th><th>{t('cg.thCond', 'Condizioni')}</th><th>{t('cg.thEconomy', 'Economia')}</th><th>{t('cg.thActions', 'Azioni')}</th></tr>
            </thead>
            <tbody>
              {combat.combatants.map((c, i) => (
                <tr key={c.id} className={i === combat.turnIndex ? 'turn-active' : undefined} style={i === combat.turnIndex ? { background: 'var(--panel2)' } : undefined}>
                  <td><b>{c.initiative}</b></td>
                  <td>
                    {c.name} {c.isPlayer && <span className="tag">{t('cb.player', 'PG')}</span>}
                    {c.concentrating && <span className="tag custom" title={t('cb.concTitle', 'Concentrazione attiva')}>{tf('cg.concChip', '🎯 {name}', { name: reg.spells.get(c.concentrating)?.name ?? c.concentrating })}</span>}
                  </td>
                  <td>{c.hp}/{c.maxHp}</td>
                  <td>{c.ac}</td>
                  <td>{c.conditions.map((cd) => <span key={cd} className="tag custom">{CONDITIONS.find((x) => x.id === cd)?.name ?? cd}{c.conditionRounds[cd] ? ` (${c.conditionRounds[cd]})` : ''}</span>)}</td>
                  <td className="muted" style={{ fontSize: 11 }}>
                    {c.actionUsed ? tf('cg.used', '❌{w}', { w: t('cg.action', 'azione') }) : tf('cg.free', '✅{w}', { w: t('cg.action', 'azione') })} · {c.bonusUsed ? tf('cg.used', '❌{w}', { w: t('cg.bonusW', 'bonus') }) : tf('cg.free', '✅{w}', { w: t('cg.bonusW', 'bonus') })} · {c.reactionUsed ? tf('cg.used', '❌{w}', { w: t('cg.reactionW', 'reazione') }) : tf('cg.free', '✅{w}', { w: t('cg.reactionW', 'reazione') })} · 🏃{c.movement}
                  </td>
                  <td>
                    {(isMyTurn || isMaster) && cur?.id === c.id && (
                      <span className="row">
                        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ width: 110 }}>
                          <option value="">{t('cg.target', 'bersaglio...')}</option>
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
                        <button disabled={c.bonusUsed} onClick={() => act({ kind: 'useBonus' })}>{t('cg.bonus', '⚡bonus')}</button>
                        <button disabled={c.reactionUsed} onClick={() => act({ kind: 'useReaction' })}>{t('cg.reaction', '🛡️reazione')}</button>
                      </span>
                    )}
                    {c.isPlayer && c.concentrating && cur?.id === c.id && (isMyTurn || isMaster) && (
                      <button title={t('cg.dropConc', 'Interrompi la concentrazione')} onClick={() => act({ kind: 'dropConcentration' })}>🎯✕</button>
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
                <option value="">{t('cg.addCondTurn', '+ condizione al turno corrente...')}</option>
                {CONDITIONS.map((cd) => <option key={cd.id} value={cd.id}>{cd.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {combat && (
        <div className="card">
          <h3>{t('cg.log', '📜 Log')}</h3>
          <div style={{ maxHeight: 220, overflow: 'auto', fontSize: 12 }}>
            {[...combat.log].reverse().slice(0, 30).map((l, i) => <div key={i} className="muted">{l}</div>)}
          </div>
        </div>
      )}

      <div className="card">
        <h3>💬 {t('cg.chatTitle', 'Chat di campagna')}</h3>
        <div className="chat-box">
          {(campaign.chat ?? []).length === 0 ? (
            <div className="muted">{t('cg.chatEmpty', 'Nessun messaggio: scrivi il primo!')}</div>
          ) : (
            (campaign.chat ?? []).slice(-60).map((m) => (
              <div key={m.id} className="chat-msg">
                <b>{m.fromId === you.id ? t('cg.you', 'tu') : m.from}</b>
                <span className="muted"> {m.at.slice(11, 16)}</span>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
              </div>
            ))
          )}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={onEnter(() => { const txt = chatText.trim(); if (txt) { act({ kind: 'chat', text: txt }); setChatText(''); } })}
            placeholder={t('cg.chatPh', 'Scrivi un messaggio alla campagna…')}
            maxLength={500}
            style={{ flex: 1 }}
          />
          <button
            className="primary"
            disabled={!chatText.trim()}
            onClick={() => { const txt = chatText.trim(); if (txt) { act({ kind: 'chat', text: txt }); setChatText(''); } }}
          >
            {t('cg.chatSend', 'Invia')}
          </button>
        </div>
      </div>

      {!combat && !isMaster && (
        <div className="card"><h3>{t('cg.waiting', '⏳ In attesa...')}</h3><div className="muted">{t('cg.waitingHint', 'Il master avvierà il combattimento. Assicurati di aver caricato la tua scheda.')}</div></div>
      )}
    </div>
  );
}
