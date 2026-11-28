/**
 * Validazione SERVER-SIDE delle immagini (ritratto del PG) pubblicate sul server:
 * il client puo' essere modificato, quindi ogni data URL va ricontrollata qui.
 *
 * Controlli "a prova di bomba":
 *  - solo data URL `data:image/(png|jpeg|webp|gif);base64,...` (niente SVG/HTML: XSS);
 *  - base64 valido e dimensione decodificata <= DND5E_MAX_PORTRAIT_BYTES (default 1 MiB);
 *  - magic bytes coerenti col mime dichiarato;
 *  - dimensioni lette dall'header (PNG IHDR, JPEG SOF, GIF logical screen, WebP VP8X/VP8/VP8L)
 *    <= DND5E_MAX_IMAGE_DIM (default 4096x4096): blocca le decompression bomb.
 * Ritorna la stringa originale se valida, altrimenti undefined (il chiamante la stronca).
 */

function envInt(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/** byte max del ritratto decodificato (default 1 MiB) */
export const MAX_PORTRAIT_BYTES = envInt('DND5E_MAX_PORTRAIT_BYTES', 1024 * 1024);
/** lato max in pixel (default 4096) */
export const MAX_IMAGE_DIM = envInt('DND5E_MAX_IMAGE_DIM', 4096);
/** lunghezza max della data URL (base64 ~4/3 dei byte + header) */
const MAX_DATAURL_LEN = Math.ceil(MAX_PORTRAIT_BYTES * 4 / 3) + 128;

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** dimensioni PNG dall'IHDR (offset 16: width/height big-endian) */
function pngDims(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** dimensioni JPEG: scan dei marker fino a un SOF (C0-CF esclusi C4/C8/CC) */
function jpegDims(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** dimensioni GIF dal logical screen descriptor (offset 6, little-endian) */
function gifDims(buf: Buffer): { w: number; h: number } | null {
  const sig = buf.toString('ascii', 0, 6);
  if (buf.length < 10 || (sig !== 'GIF87a' && sig !== 'GIF89a')) return null;
  return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
}

/** dimensioni WebP (RIFF/WEBP): primo chunk VP8X (canvas) oppure VP8 (lossy) / VP8L (lossless) */
function webpDims(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    if (buf.length < 30) return null;
    return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  }
  if (fourcc === 'VP8 ') {
    // frame tag (3 byte) + start code 9D 01 2A + width/height (14 bit + 2 bit di scala)
    if (buf.length < 30 || buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    if (buf.length < 26 || buf[20] !== 0x2f) return null;
    const v = buf.readUInt32LE(21);
    return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) };
  }
  return null;
}

function dimsOk(w: number, h: number): boolean {
  return Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= MAX_IMAGE_DIM && h <= MAX_IMAGE_DIM;
}

/** true se il buffer e' un'immagine del mime dichiarato con dimensioni entro i limiti */
export function isAllowedImage(buf: Buffer, mime: string): boolean {
  if (buf.length === 0 || buf.length > MAX_PORTRAIT_BYTES) return false;
  let dims: { w: number; h: number } | null = null;
  if (mime === 'image/png') dims = pngDims(buf);
  else if (mime === 'image/jpeg') dims = jpegDims(buf);
  else if (mime === 'image/gif') dims = gifDims(buf);
  else if (mime === 'image/webp') dims = webpDims(buf);
  else return false;
  return !!dims && dimsOk(dims.w, dims.h);
}

/**
 * Sanifica il ritratto di una scheda: ritorna la data URL originale se valida,
 * altrimenti undefined (da impostare a `undefined` sulla scheda salvata).
 */
export function sanitizePortrait(p: unknown): string | undefined {
  if (typeof p !== 'string' || p.length === 0) return undefined;
  if (p.length > MAX_DATAURL_LEN) return undefined;
  const m = DATA_URL_RE.exec(p);
  if (!m) return undefined;
  const [, mime, b64] = m;
  if (b64.length % 4 !== 0) return undefined;
  const buf = Buffer.from(b64, 'base64');
  // Buffer.from('base64') ignora i caratteri sporchi: ricontrollo che la decodifica sia pulita
  if (buf.length === 0 || buf.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) return undefined;
  if (!isAllowedImage(buf, mime)) return undefined;
  return p;
}
