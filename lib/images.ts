// Server-side clinical-image reveal plumbing, shared by the Anthropic path
// (app/api/examiner) and the dev CLI bridge (lib/devCli.ts).
//
// The examiner is the reveal gate: it discloses findings only when the candidate
// examines the right region, and it releases a photo the same way — by appending
// an opaque {{IMG:<id>}} marker to the reply when (and only when) that finding is
// earned. The backend strips the marker and returns the matching image. Marker
// ids carry no diagnosis, captions are sign-level, and unknown ids are ignored,
// so nothing here can leak the answer (invariant 1) even if the model misbehaves.

import type { CaseImage, RevealedImage } from './types';

/** e.g. "{{IMG:im03}}" — deliberately ASCII + distinctive so models emit it cleanly. */
const IMG_MARKER = /\{\{\s*IMG:\s*(im\d+)\s*\}\}/gi;

/** At most this many photos may surface in a single reply (guards against dumps). */
const MAX_IMAGES_PER_REPLY = 4;

/**
 * The block-2 examiner instruction listing this case's available photos. Returns
 * '' when the case has no images (no section, no behaviour change).
 */
export function buildImageSection(images: CaseImage[]): string {
  if (images.length === 0) return '';
  const lines = images.map((im) => `  ${im.id} — [examine: ${im.region}] ${im.caption}`);
  return [
    '# CLINICAL PHOTOGRAPHS AVAILABLE (reveal like any finding — never on the stem)',
    'Real photographs exist for some of this case\'s findings. Reveal one ONLY when the candidate actually examines the region shown and you disclose that finding — by appending its marker on its own line at the END of that reply, in the exact form {{IMG:im0X}}.',
    'Rules (same discipline as text findings):',
    '- NEVER reveal a photo on the stem, before the candidate examines that region, or to hint an unexamined sign.',
    '- Emit each photo at most once. Do not mention that photographs exist, and do not describe the marker — just append the token when the moment is earned; the app renders the image.',
    '- Only these ids are valid for this case:',
    ...lines,
  ].join('\n');
}

/**
 * Strip {{IMG:id}} markers from a reply and resolve them to client-safe images.
 * Only ids belonging to this case resolve; duplicates and unknown ids are dropped;
 * result is capped at MAX_IMAGES_PER_REPLY.
 */
export function extractRevealedImages(
  text: string,
  images: CaseImage[]
): { text: string; images: RevealedImage[] } {
  const byId = new Map(images.map((i) => [i.id.toLowerCase(), i]));
  const seen = new Set<string>();
  const revealed: RevealedImage[] = [];
  let m: RegExpExecArray | null;
  IMG_MARKER.lastIndex = 0;
  while ((m = IMG_MARKER.exec(text)) !== null) {
    const id = m[1].toLowerCase();
    const im = byId.get(id);
    if (im && !seen.has(id) && revealed.length < MAX_IMAGES_PER_REPLY) {
      seen.add(id);
      revealed.push({ url: im.url, caption: im.caption });
    }
  }
  const cleaned = text
    .replace(IMG_MARKER, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: cleaned, images: revealed };
}
