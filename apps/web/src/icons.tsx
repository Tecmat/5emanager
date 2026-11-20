import type { ReactElement } from 'react';

export type IconName =
  | 'home'
  | 'user'
  | 'wand'
  | 'bag'
  | 'swords'
  | 'map'
  | 'flask'
  | 'globe'
  | 'plus'
  | 'pencil'
  | 'undo'
  | 'moon'
  | 'sun'
  | 'lock'
  | 'eye'
  | 'x'
  | 'wifi'
  | 'offline'
  | 'check'
  | 'back'
  | 'book'
  | 'bell'
  | 'monitor'
  | 'radar'
  | 'play'
  | 'users'
  | 'qr'
  | 'dice'
  | 'key'
  | 'door'
  | 'signal';

const PATHS: Record<IconName, ReactElement> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 14.5-4 16 0" />
    </>
  ),
  wand: (
    <>
      <path d="m3 21 9-9" />
      <path d="M15 4V2" />
      <path d="M15 16v-2" />
      <path d="M8 9h2" />
      <path d="M20 9h2" />
      <path d="m17.8 11.8 1.4 1.4" />
      <path d="m17.8 6.2 1.4-1.4" />
      <path d="m12.2 6.2-1.4-1.4" />
      <path d="m12.2 11.8-1.4 1.4" />
    </>
  ),
  bag: (
    <>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </>
  ),
  swords: (
    <>
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" x2="19" y1="19" y2="13" />
      <line x1="16" x2="20" y1="16" y2="20" />
      <line x1="19" x2="21" y1="21" y2="19" />
      <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
      <line x1="5" x2="9" y1="14" y2="18" />
      <line x1="7" x2="4" y1="17" y2="20" />
      <line x1="3" x2="5" y1="19" y2="21" />
    </>
  ),
  map: (
    <>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </>
  ),
  flask: (
    <>
      <path d="M10 2v6.3L4.5 19a1 1 0 0 0 .9 1.5h13.2a1 1 0 0 0 .9-1.5L14 8.3V2" />
      <path d="M8.5 2h7" />
      <path d="M7 15h10" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.7 2.6 4 5.6 4 9s-1.3 6.4-4 9c-2.7-2.6-4-5.6-4-9s1.3-6.4 4-9Z" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  pencil: (
    <>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </>
  ),
  undo: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.3 17.7-1.4 1.4" />
      <path d="m19.1 4.9-1.4 1.4" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  wifi: (
    <>
      <path d="M2 8.82a15 15 0 0 1 20 0" />
      <path d="M5 12.86a10 10 0 0 1 14 0" />
      <path d="M8.5 16.43a5 5 0 0 1 7 0" />
      <path d="M12 20h.01" />
    </>
  ),
  offline: (
    <>
      <path d="m2 2 20 20" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M5 13a10 10 0 0 1 4.2-2.3" />
      <path d="M14.8 10.9A10 10 0 0 1 19 13" />
      <path d="M2 8.8a15 15 0 0 1 4.4-2.5" />
      <path d="M17.6 6.5A15 15 0 0 1 22 8.8" />
      <path d="M12 20h.01" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  back: (
    <>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </>
  ),
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6" />
      <path d="M12 16v4" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12 18.5 5.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5-13-7.5Z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1-3.5 12-3.5 13 0" />
      <path d="M16 5a3.5 3.5 0 0 1 0 7" />
      <path d="M17.5 16.5c2 .8 3 2 3.5 3.5" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3z" />
      <path d="M21 14v3" />
      <path d="M14 21h3" />
      <path d="M21 21h.01" />
    </>
  ),
  dice: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4.5" />
      <path d="m11 12 9-9" />
      <path d="m16 7 3 3" />
      <path d="m13.5 9.5 2.5 2.5" />
    </>
  ),
  door: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <path d="M2 21h20" />
      <circle cx="12.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  signal: (
    <>
      <path d="M5.5 10.5a9 9 0 0 1 13 0" />
      <path d="M8.5 13.5a5 5 0 0 1 7 0" />
      <circle cx="12" cy="17.5" r="1.6" fill="currentColor" stroke="none" />
      <path d="M2.5 7.5a13.5 13.5 0 0 1 19 0" />
    </>
  ),
};

/** gradienti "candy" (stile KDE/Breeze colorato) per icona: tile arrotondato colorato + glifo bianco */
const CANDY: Partial<Record<IconName, [string, string]>> = {
  home: ['#f7b731', '#fc5c65'],
  user: ['#a29bfe', '#6c5ce7'],
  wand: ['#a29bfe', '#6c5ce7'],
  bag: ['#fd9644', '#e17055'],
  swords: ['#e17055', '#d63031'],
  map: ['#00b894', '#00cec9'],
  flask: ['#00b894', '#55efc4'],
  globe: ['#0984e3', '#74b9ff'],
  plus: ['#00b894', '#55efc4'],
  pencil: ['#fdcb6e', '#e17055'],
  undo: ['#636e72', '#b2bec3'],
  moon: ['#6c5ce7', '#a29bfe'],
  sun: ['#fdcb6e', '#f39c12'],
  lock: ['#636e72', '#2d3436'],
  eye: ['#0984e3', '#74b9ff'],
  x: ['#d63031', '#e17055'],
  wifi: ['#0984e3', '#74b9ff'],
  offline: ['#636e72', '#b2bec3'],
  check: ['#00b894', '#55efc4'],
  back: ['#636e72', '#b2bec3'],
  book: ['#e17055', '#fdcb6e'],
  bell: ['#fdcb6e', '#f39c12'],
  monitor: ['#6c5ce7', '#a29bfe'],
  radar: ['#00cec9', '#0984e3'],
  play: ['#00b894', '#55efc4'],
  users: ['#0984e3', '#6c5ce7'],
  qr: ['#2d3436', '#636e72'],
  dice: ['#d63031', '#fd9644'],
  key: ['#e17055', '#fdcb6e'],
  door: ['#00b894', '#00cec9'],
  signal: ['#a29bfe', '#e84393'],
};

export default function Icon({ name, size = 16, className = '', candy = false }: { name: IconName; size?: number; className?: string; candy?: boolean }) {
  const paths = PATHS[name];
  if (candy) {
    const g = CANDY[name] ?? ['#636e72', '#b2bec3'];
    const pad = Math.max(2, Math.round(size * 0.18));
    const box = size + pad * 2;
    return (
      <span
        className={`candy-icon${className ? ` ${className}` : ''}`}
        style={{
          display: 'inline-flex',
          width: box,
          height: box,
          borderRadius: Math.round(box * 0.3),
          background: `linear-gradient(135deg, ${g[0]}, ${g[1]})`,
          boxShadow: '0 1px 4px rgba(0,0,0,.35)',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
        aria-hidden="true"
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          {paths}
        </svg>
      </span>
    );
  }
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  );
}
