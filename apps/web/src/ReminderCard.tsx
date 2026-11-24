import { useEffect, useState } from 'react';
import { useStore } from './store.js';
import Icon from './icons.js';
import { dueReminder, ensureNotificationPermission, loadReminder, saveReminder } from './reminder.js';

/** card "Promemoria di sessione": imposta una data/ora e un testo; alla scadenza parte una notifica */
export default function ReminderCard() {
  const { t, tf } = useStore();
  const [when, setWhen] = useState('');
  const [text, setText] = useState('');
  const [current, setCurrent] = useState(loadReminder);
  const [perm, setPerm] = useState<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  useEffect(() => {
    const iv = setInterval(() => setCurrent(loadReminder()), 15000);
    return () => clearInterval(iv);
  }, []);

  const set = async () => {
    if (!when) return;
    const p = await ensureNotificationPermission();
    setPerm(p);
    const r = { at: new Date(when).toISOString(), text: text.trim() || t('rem.default', 'Sessione di gioco!'), notified: false };
    saveReminder(r);
    setCurrent(r);
    setWhen('');
    setText('');
  };

  const clear = () => {
    saveReminder(null);
    setCurrent(null);
  };

  return (
    <div className="card">
      <h3 className="home-h"><Icon name="bell" size={15} /> {t('rem.title', 'Promemoria di sessione')}</h3>
      {current ? (
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>
            🔔 <b>{current.text}</b>
            <span className="muted"> — {new Date(current.at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
            {dueReminder() && <span className="tag custom"> {t('rem.due', 'scaduto: notifica inviata')}</span>}
          </span>
          <button className="danger" onClick={clear}>{t('rem.clear', 'Rimuovi')}</button>
        </div>
      ) : (
        <>
          <div className="muted" style={{ marginBottom: 8 }}>{t('rem.hint', 'Scegli data e ora: quando arriva parte una notifica (anche con l\'app installata come PWA).')}</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ width: 'auto' }} />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('rem.ph', 'Sessione con il gruppo…')} style={{ flex: 1, minWidth: 160 }} maxLength={120} />
            <button className="primary" disabled={!when} onClick={() => void set()}>
              {perm === 'granted' ? t('rem.set', 'Imposta promemoria') : tf('rem.setNotif', 'Imposta promemoria (notifiche: {p})', { p: perm })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
