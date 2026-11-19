/**
 * Generatore QR "hand-rolled" (zero dipendenze): byte mode, EC level L,
 * versione automatica 1-40, maschera scelta per penalità (come da spec).
 * Usato per mostrare i codici invito P2P come QR scansionabili dal telefono.
 */

// ---- tabelle di specifica (EC level L) ----
// per ogni versione 1..40: [ecCodewordsPerBlocco, blocchiGruppo1, datiGruppo1, blocchiGruppo2, datiGruppo2]
const EC_L: [number, number, number, number, number][] = [
  [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0],
  [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
  [20, 4, 81, 0, 0], [24, 2, 92, 2, 93], [26, 4, 107, 0, 0], [30, 3, 115, 1, 116], [22, 5, 87, 1, 88],
  [24, 5, 98, 1, 99], [28, 1, 107, 5, 108], [30, 5, 120, 1, 121], [28, 3, 113, 4, 114], [28, 3, 107, 5, 108],
  [28, 4, 116, 4, 117], [28, 2, 111, 7, 112], [30, 4, 121, 5, 122], [30, 6, 117, 4, 118], [26, 8, 106, 4, 107],
  [28, 10, 114, 2, 115], [30, 8, 122, 4, 123], [30, 3, 117, 10, 118], [30, 7, 116, 7, 117], [30, 5, 115, 10, 116],
  [30, 13, 115, 3, 116], [30, 17, 115, 0, 0], [30, 17, 115, 1, 116], [30, 13, 115, 6, 116], [30, 12, 121, 7, 122],
  [30, 6, 121, 14, 122], [30, 17, 122, 4, 123], [30, 4, 122, 18, 123], [30, 20, 117, 4, 118], [30, 19, 118, 6, 119],
];

// posizioni dei pattern di allineamento per versione 1..40
const ALIGN: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
  [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

// ---- GF(256) ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** polinomio generatore RS, MSB-first: g(x) = prod (x + a^i), g[0] = 1 */
function rsGenPoly(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let a = 0; a < g.length; a++) {
      next[a] ^= g[a]; // * x
      next[a + 1] ^= gfMul(g[a], EXP[i]); // * a^i
    }
    g = next;
  }
  return g;
}

function rsEncode(data: number[], degree: number): number[] {
  const gen = rsGenPoly(degree); // MSB-first
  const msg = [...data, ...new Array(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) for (let j = 1; j <= degree; j++) msg[i + j] ^= gfMul(gen[j], coef);
  }
  return msg.slice(data.length);
}

// ---- costruzione ----
export interface QrResult {
  matrix: boolean[]; // size*size, true = nero
  size: number;
  version: number;
  mask: number;
}

function totalDataCodewords(version: number): number {
  const [ec, g1n, g1d, g2n, g2d] = EC_L[version - 1];
  return g1n * g1d + g2n * g2d + 0 * ec;
}

function byteCapacity(version: number): number {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((totalDataCodewords(version) * 8 - 4 - countBits) / 8);
}

export function qrEncode(text: string): QrResult | null {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = -1;
  for (let v = 1; v <= 40; v++) {
    if (byteCapacity(v) >= bytes.length) { version = v; break; }
  }
  if (version < 0) return null;

  const size = 17 + 4 * version;
  const countBits = version <= 9 ? 8 : 16;
  const totalData = totalDataCodewords(version);

  // bit stream: mode 0100 + count + dati + terminator + pad
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, countBits);
  for (const b of bytes) pushBits(b, 8);
  const capacityBits = totalData * 8;
  pushBits(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  let pad = 0xec;
  while (data.length < totalData) data.push(pad), (pad = pad === 0xec ? 0x11 : 0xec);

  // split in blocchi + ECC + interleave
  const [ecPerBlock, g1n, g1d, g2n, g2d] = EC_L[version - 1];
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  let off = 0;
  for (let i = 0; i < g1n; i++) { const b = data.slice(off, off + g1d); off += g1d; blocks.push(b); eccs.push(rsEncode(b, ecPerBlock)); }
  for (let i = 0; i < g2n; i++) { const b = data.slice(off, off + g2d); off += g2d; blocks.push(b); eccs.push(rsEncode(b, ecPerBlock)); }
  const finalData: number[] = [];
  const maxLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) finalData.push(b[i]);
  const maxEcc = ecPerBlock;
  for (let i = 0; i < maxEcc; i++) for (const e of eccs) if (i < e.length) finalData.push(e[i]);

  // ---- matrice ----
  const m: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x: number, y: number, v: boolean) => { m[y][x] = v; reserved[y][x] = true; };

  // finder + separatori
  const finder = (x0: number, y0: number) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const on = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFn(x, y, on);
    }
  };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  // timing
  for (let i = 8; i < size - 8; i++) { setFn(i, 6, i % 2 === 0); setFn(6, i, i % 2 === 0); }
  // allineamento
  const pos = ALIGN[version - 1];
  for (const y of pos) for (const x of pos) {
    if ((x === 6 && y === 6) || (x === size - 7 && y === 6) || (x === 6 && y === size - 7)) continue; // sovrapposti ai finder
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // dark module + aree format info
  setFn(8, size - 8, true);
  for (let i = 0; i <= 8; i++) { reserved[8][i] = true; reserved[i][8] = true; } // include (8,8): cella format info
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
  reserved[size - 8][8] = true;
  // aree version info (v>=7): blocco alto-destra e basso-sinistra
  if (version >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      reserved[i][size - 11 + j] = true;
      reserved[size - 11 + j][i] = true;
    }
  }

  // piazzamento dati a zigzag
  const dataBits: number[] = [];
  for (const b of finalData) for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1);
  let bitIdx = 0;
  let upward = true;
  for (let x0 = size - 1; x0 >= 1; x0 -= 2) {
    let x = x0;
    if (x <= 6) x -= 1; // salta la colonna di timing (6)
    for (let i = 0; i < size; i++) {
      const y = upward ? size - 1 - i : i;
      for (const xx of [x, x - 1]) {
        if (!reserved[y][xx] && bitIdx < dataBits.length) {
          m[y][xx] = dataBits[bitIdx++] === 1;
        }
      }
    }
    upward = !upward;
  }

  // maschere + penalità
  const maskBit = (mask: number, x: number, y: number): boolean => {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const formatInfo = (mask: number): number => {
    // EC level L = 01
    const data = (0b01 << 3) | mask;
    let rem = data << 10;
    const g = 0b10100110111;
    for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= g << (i - 10);
    return (((data << 10) | rem) ^ 0b101010000010010) & 0x7fff;
  };
  const versionInfo = (v: number): number => {
    let rem = v << 12;
    const g = 0b1111100100101;
    for (let i = 17; i >= 12; i--) if ((rem >> i) & 1) rem ^= g << (i - 12);
    return (v << 12) | rem;
  };
  // posizione del bit i (0=LSB) del format info, in entrambe le copie (x, y)
  const formatPos = (i: number, size: number, copy: 1 | 2): [number, number] => {
    if (copy === 1) {
      if (i < 6) return [8, i];
      if (i === 6) return [8, 7];
      if (i === 7) return [8, 8];
      if (i === 8) return [7, 8];
      return [14 - i, 8];
    }
    if (i < 8) return [size - 1 - i, 8];
    return [8, size - 15 + i];
  };

  const penalty = (mm: boolean[][]): number => {
    let p = 0;
    // righe/colonne: 5+ uguali consecutivi
    for (let y = 0; y < size; y++) {
      let run = 1;
      for (let x = 1; x < size; x++) {
        if (mm[y][x] === mm[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
        else run = 1;
      }
    }
    for (let x = 0; x < size; x++) {
      let run = 1;
      for (let y = 1; y < size; y++) {
        if (mm[y][x] === mm[y - 1][x]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
        else run = 1;
      }
    }
    // blocchi 2x2
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      if (mm[y][x] === mm[y][x + 1] && mm[y][x] === mm[y + 1][x] && mm[y][x] === mm[y + 1][x + 1]) p += 3;
    }
    // pattern finder-like
    const pat = [true, false, true, true, true, false, true];
    for (let y = 0; y < size; y++) for (let x = 0; x + 7 <= size; x++) {
      let ok = true;
      for (let i = 0; i < 7; i++) if (mm[y][x + i] !== pat[i]) { ok = false; break; }
      if (ok) p += 40;
    }
    for (let x = 0; x < size; x++) for (let y = 0; y + 7 <= size; y++) {
      let ok = true;
      for (let i = 0; i < 7; i++) if (mm[y + i][x] !== pat[i]) { ok = false; break; }
      if (ok) p += 40;
    }
    // bilanciamento
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mm[y][x]) dark++;
    const pct = (dark * 100) / (size * size);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  };

  let best: boolean[][] | null = null;
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const mm: boolean[][] = m.map((row) => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!reserved[y][x] && maskBit(mask, x, y)) mm[y][x] = !mm[y][x];
    }
    // format info sulla matrice candidata (bit i = LSB)
    const fi = formatInfo(mask);
    for (let i = 0; i < 15; i++) {
      const bit = ((fi >> i) & 1) === 1;
      const [x1, y1] = formatPos(i, size, 1);
      const [x2, y2] = formatPos(i, size, 2);
      mm[y1][x1] = bit;
      mm[y2][x2] = bit;
    }
    mm[size - 8][8] = true; // dark module
    if (version >= 7) {
      const vi = versionInfo(version);
      for (let i = 0; i < 18; i++) {
        const bit = ((vi >> i) & 1) === 1;
        mm[Math.floor(i / 3)][size - 11 + (i % 3)] = bit; // alto-destra
        mm[size - 11 + (i % 3)][Math.floor(i / 3)] = bit; // basso-sinistra
      }
    }
    const p = penalty(mm);
    if (p < bestPenalty) { bestPenalty = p; best = mm; bestMask = mask; }
  }
  return { matrix: best!.flat(), size, version, mask: bestMask };
}

/** SVG del QR (nero su trasparente) */
export function qrSvg(res: QrResult, scale = 4, margin = 4): string {
  const { matrix, size } = res;
  const total = (size + margin * 2) * scale;
  let rects = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (matrix[y * size + x]) rects += `<rect x="${(x + margin) * scale}" y="${(y + margin) * scale}" width="${scale}" height="${scale}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

function errText(e: unknown): string {
  return typeof e === 'string' ? e : (e as Error)?.message ?? String(e);
}

/** su Android (Capacitor) chiede il permesso CAMERA a runtime: senza di esso getUserMedia fallisce senza prompt */
async function ensureCameraPermission(): Promise<void> {
  const { Capacitor, registerPlugin } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Camera } = await import('@capacitor/camera');
    const p = await Camera.checkPermissions();
    if (p.camera !== 'granted') {
      const r = await Camera.requestPermissions({ permissions: ['camera'] });
      if (r.camera !== 'granted') {
        // negato (anche "non chiedere più"): apri le impostazioni dell'app e spiega
        try {
          const installer = registerPlugin<{ openAppSettings(): Promise<void> }>('UpdateInstaller');
          await installer.openAppSettings();
        } catch { /* ignora */ }
        throw new Error('Permesso fotocamera negato: è stato aperto Impostazioni → App → 5e Manager → Autorizzazioni → Fotocamera, concedilo e riprova');
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Permesso fotocamera')) throw e;
    // plugin non presente: prova comunque con getUserMedia
  }
}

/** scansiona un QR con la fotocamera, se il browser lo supporta (BarcodeDetector, es. Chrome Android) */
export async function scanQr(): Promise<string> {
  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } });
  if (!BD.BarcodeDetector) throw new Error('Scansione QR non supportata da questo browser (usa incolla)');
  await ensureCameraPermission();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    throw new Error('Fotocamera non disponibile o permesso negato (' + errText(e) + ') — usa "incolla il codice"');
  }
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const det = new BD.BarcodeDetector({ formats: ['qr_code'] });
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const codes = await det.detect(video);
      if (codes.length > 0) return codes[0].rawValue;
    }
    throw new Error('Nessun QR trovato (inquadra il codice)');
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
