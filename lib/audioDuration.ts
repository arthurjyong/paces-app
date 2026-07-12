// Server-side audio duration sniffing for /api/transcribe (review 2026-07-12).
//
// WHY THIS EXISTS. STT is billed per audio MINUTE, but our only pre-call
// bound on an upload was its BYTE size — and bytes don't bound duration: a
// 3.5 MB Opus/DTX file can claim many hours of audio. Two confirmed defects
// followed: (a) a crafted long clip makes the provider bill the operator for
// hours while our 55s fetch abort released the reservation uncharged (the
// caps never engaged); (b) a lane that reports no duration (gateway
// gpt-4o-transcribe always does) settled at the full 15-minute reserve.
//
// So the route now reads the duration OUT OF THE CONTAINER ITSELF, before any
// key is touched: too long → 400 with nothing spent and no upstream call; and
// when the provider reports no duration, this is the settle basis instead of
// the reservation ceiling.
//
// The parsers are deliberately shallow and total: they read only the header
// structures they need, bail out (null) on anything unexpected, and never
// throw. `null` means "unknown" — the caller must treat that conservatively
// (we charge the reservation ceiling), never as zero.
//
// A forged-short header is NOT a security hole: it can only make the operator
// (not the ledger) eat the difference on a crafted clip — the case SPEC.md
// residual risk 5 already accepts — while the charge-on-timeout rule keeps
// the per-user and global caps engaged regardless.

/** Best-effort duration in seconds from the container header, or null. */
export function sniffAudioDurationSeconds(buf: Buffer, mime: string): number | null {
  try {
    switch (mime) {
      case 'audio/mp4':
      case 'audio/x-m4a':
        return mp4Duration(buf);
      case 'audio/webm':
        return webmDuration(buf);
      case 'audio/ogg':
        return oggDuration(buf);
      default:
        return null;
    }
  } catch {
    return null; // malformed header — unknown, not zero
  }
}

// ── MP4 / M4A (ISO-BMFF): moov → mvhd carries timescale + duration ──────────

function mp4Duration(buf: Buffer): number | null {
  const moov = findBox(buf, 0, buf.length, 'moov');
  if (!moov) return null;
  const mvhd = findBox(buf, moov.start, moov.end, 'mvhd');
  if (!mvhd || mvhd.end - mvhd.start < 20) return null;

  let p = mvhd.start;
  const version = buf.readUInt8(p);
  p += 4; // version(1) + flags(3)
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (mvhd.end - p < 28) return null;
    p += 16; // creation(8) + modification(8)
    timescale = buf.readUInt32BE(p);
    p += 4;
    const hi = buf.readUInt32BE(p);
    const lo = buf.readUInt32BE(p + 4);
    duration = hi * 2 ** 32 + lo;
  } else {
    if (mvhd.end - p < 12) return null;
    p += 8; // creation(4) + modification(4)
    timescale = buf.readUInt32BE(p);
    p += 4;
    duration = buf.readUInt32BE(p);
  }
  if (!timescale || !Number.isFinite(duration)) return null;
  // 0xffffffff / 2^64-1 = "unknown duration" (fragmented MP4 — what Safari's
  // MediaRecorder writes). Unknown, not zero.
  if (duration >= 0xffffffff) return null;
  const seconds = duration / timescale;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

interface Box {
  start: number; // first byte of the box PAYLOAD
  end: number; // one past the last byte of the payload
}

/** Scan sibling boxes in [from, to) for `type`; recurses only where asked. */
function findBox(buf: Buffer, from: number, to: number, type: string): Box | null {
  let p = from;
  while (p + 8 <= to) {
    const size = buf.readUInt32BE(p);
    const boxType = buf.toString('latin1', p + 4, p + 8);
    let headerLen = 8;
    let boxSize = size;
    if (size === 1) {
      // 64-bit largesize
      if (p + 16 > to) return null;
      const hi = buf.readUInt32BE(p + 8);
      const lo = buf.readUInt32BE(p + 12);
      boxSize = hi * 2 ** 32 + lo;
      headerLen = 16;
    } else if (size === 0) {
      boxSize = to - p; // extends to end
    }
    if (boxSize < headerLen) return null; // malformed
    const end = Math.min(p + boxSize, to);
    if (boxType === type) return { start: p + headerLen, end };
    p += boxSize;
  }
  return null;
}

// ── WebM / Matroska: Segment → Info → TimecodeScale + Duration ──────────────

const EBML_SEGMENT = 0x18538067;
const EBML_INFO = 0x1549a966;
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_DURATION = 0x4489;

function webmDuration(buf: Buffer): number | null {
  const segment = findEbml(buf, 0, buf.length, EBML_SEGMENT, 4);
  if (!segment) return null;
  const info = findEbml(buf, segment.start, segment.end, EBML_INFO, 4);
  if (!info) return null;

  const scaleEl = findEbml(buf, info.start, info.end, EBML_TIMECODE_SCALE, 3);
  const durEl = findEbml(buf, info.start, info.end, EBML_DURATION, 2);
  if (!durEl) return null; // live-recorded WebM often omits it → unknown

  let timecodeScale = 1_000_000; // ns, spec default
  if (scaleEl) {
    const n = readUintN(buf, scaleEl.start, scaleEl.end);
    if (n !== null && n > 0) timecodeScale = n;
  }
  const len = durEl.end - durEl.start;
  let raw: number;
  if (len === 4) raw = buf.readFloatBE(durEl.start);
  else if (len === 8) raw = buf.readDoubleBE(durEl.start);
  else return null;
  if (!Number.isFinite(raw) || raw < 0) return null;
  const seconds = (raw * timecodeScale) / 1e9;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

interface Ebml {
  start: number;
  end: number;
}

/** Find a direct-child EBML element with `id` (whose encoded id is idLen bytes). */
function findEbml(
  buf: Buffer,
  from: number,
  to: number,
  id: number,
  idLen: number
): Ebml | null {
  let p = from;
  let guard = 0;
  while (p < to && guard++ < 4096) {
    const idInfo = readEbmlId(buf, p, to);
    if (!idInfo) return null;
    const sizeInfo = readEbmlSize(buf, idInfo.next, to);
    if (!sizeInfo) return null;
    const payloadStart = sizeInfo.next;
    // Unknown-size element (live streams): treat as running to the end.
    const payloadEnd =
      sizeInfo.value === null ? to : Math.min(payloadStart + sizeInfo.value, to);
    if (payloadEnd < payloadStart) return null;
    if (idInfo.id === id && idInfo.len === idLen) {
      return { start: payloadStart, end: payloadEnd };
    }
    p = payloadEnd;
    if (payloadEnd === payloadStart && sizeInfo.value === null) return null; // no progress
  }
  return null;
}

function readEbmlId(buf: Buffer, p: number, to: number): { id: number; len: number; next: number } | null {
  if (p >= to) return null;
  const first = buf.readUInt8(p);
  if (first === 0) return null;
  let len = 1;
  for (let mask = 0x80; mask > 0; mask >>= 1) {
    if (first & mask) break;
    len++;
  }
  if (len > 4 || p + len > to) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf.readUInt8(p + i);
  return { id, len, next: p + len };
}

function readEbmlSize(
  buf: Buffer,
  p: number,
  to: number
): { value: number | null; next: number } | null {
  if (p >= to) return null;
  const first = buf.readUInt8(p);
  if (first === 0) return null;
  let len = 1;
  let mask = 0x80;
  while (mask > 0 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 8 || p + len > to) return null;
  let value = first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    const b = buf.readUInt8(p + i);
    if (b !== 0xff) allOnes = false;
    value = value * 256 + b;
  }
  return { value: allOnes ? null : value, next: p + len };
}

function readUintN(buf: Buffer, start: number, end: number): number | null {
  if (end <= start || end - start > 8) return null;
  let v = 0;
  for (let i = start; i < end; i++) v = v * 256 + buf.readUInt8(i);
  return Number.isFinite(v) ? v : null;
}

// ── Ogg (Opus/Vorbis): last page's granule position ─────────────────────────

function oggDuration(buf: Buffer): number | null {
  // Opus granule positions are always at 48 kHz regardless of input rate.
  // Vorbis uses its own sample rate; we read it from the identification
  // header when present, else assume 48k (a conservative, common case).
  let rate = 48_000;
  const idIdx = buf.indexOf('vorbis', 0, 'latin1');
  if (idIdx > 0 && idIdx + 12 <= buf.length) {
    // \x01vorbis: version(4) channels(1) rate(4 LE)
    const r = buf.readUInt32LE(idIdx + 6 + 5);
    if (r > 0 && r <= 384_000) rate = r;
  }

  // Scan backwards for the last 'OggS' capture pattern.
  const window = Math.min(buf.length, 65_536);
  const tail = buf.subarray(buf.length - window);
  const last = tail.lastIndexOf('OggS', tail.length, 'latin1');
  if (last < 0) return null;
  const pageStart = buf.length - window + last;
  if (pageStart + 14 > buf.length) return null;
  const lo = buf.readUInt32LE(pageStart + 6);
  const hi = buf.readUInt32LE(pageStart + 10);
  // 0xffffffffffffffff = "no packet finishes on this page".
  if (hi === 0xffffffff && lo === 0xffffffff) return null;
  const granule = hi * 2 ** 32 + lo;
  if (!Number.isFinite(granule) || granule < 0) return null;
  const seconds = granule / rate;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
