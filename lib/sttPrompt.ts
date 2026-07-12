// The dictation bias prompt — client-safe (no server imports).
//
// WHAT THIS IS. Whisper's `prompt` parameter is NOT an instruction: the model
// treats it as FAKE PRECEDING TRANSCRIPT and simply continues from it. So the
// prompt's job is to look like the text that would plausibly come just before
// what you are about to say — which is why it steers spelling, casing and
// register, and why it must be written in the exact form we want back.
// Evidence (same clip, whisper-large-v3, 2026-07-12): with a medical glossary
// it returns "pan-systolic murmur"; without one, "pancystolic murmur".
//
// STRUCTURE (highest-value content LAST — attention weights the end of the
// window, and the ~224-token cap means only the tail survives an overflow):
//   1. a one-line register primer  → clinical prose, sentence case, punctuation
//   2. a SPECIALTY-scoped glossary → only the ~30 terms plausible for this
//      station. NOT the whole 200-term list: the window cannot hold it, and
//      the rare-word literature shows long bias lists make the model INSERT
//      terms that were never spoken (false-biasing).
//   3. the tail of the VISIBLE transcript → this is literally what preceded
//      the audio, i.e. exactly what the parameter was designed to carry.
//
// 🚨 THE BINDING RULE (SPEC "Voice dictation"): every character here comes
// from content ALREADY ON THE CANDIDATE'S SCREEN — the stem, the examiner's
// delivered replies, their own turns, and the case's visible specialty. NEVER
// the hidden case file, expected findings, or the answer key. Beyond invariant
// 1, biasing with answer-key vocabulary would be a spoiler CHANNEL: whisper
// would happily transcribe the diagnosis into a half-heard mumble.

import { MAX_STT_PROMPT_CHARS } from './stt-shared';

/** Leave room for the transcript tail, which is the most valuable context. */
const TAIL_BUDGET = 240;

const PRIMER = 'MRCP PACES clinical examination.';

/**
 * Terms are written in the exact casing/hyphenation we want back (whisper
 * mirrors the prompt's orthography). Keyed by CaseMeta.specialty, which is
 * client-visible (it is shown in the case picker and implied by the stem).
 */
const GLOSSARIES: Record<string, string> = {
  Cardiovascular:
    'pan-systolic murmur, ejection systolic murmur, early diastolic murmur, slow-rising pulse, ' +
    'collapsing pulse, malar flush, raised JVP, displaced apex beat, thrusting apex, mid-line sternotomy scar, ' +
    'metallic first heart sound, mechanical valve, prosthetic valve, aortic stenosis, mitral regurgitation, ' +
    'atrial fibrillation, infective endocarditis, splinter haemorrhages, peripheral oedema, warfarin, bisoprolol',
  Respiratory:
    'fine end-inspiratory crackles, coarse crackles, bronchial breathing, reduced vocal resonance, ' +
    'stony dullness, pleural effusion, idiopathic pulmonary fibrosis, bronchiectasis, clubbing, ' +
    'lobectomy scar, thoracotomy scar, tracheal deviation, hyperexpanded chest, long-term oxygen therapy, ' +
    'nebulisers, home spirometry, high-resolution CT, honeycombing',
  Abdominal:
    'hepatosplenomegaly, splenomegaly, ballotable kidneys, polycystic kidney disease, ' +
    'arteriovenous fistula, renal transplant, iliac fossa, spider naevi, palmar erythema, ' +
    'gynaecomastia, caput medusae, ascites, shifting dullness, jaundice, chronic liver disease, ' +
    'tacrolimus, ciclosporin, prednisolone, haemodialysis, Dupuytren’s contracture',
  Neurology:
    'spastic paraparesis, increased tone, brisk reflexes, upgoing plantars, pyramidal weakness, ' +
    'peripheral neuropathy, glove and stocking sensory loss, absent ankle jerks, fasciculations, ' +
    'dysdiadochokinesia, past-pointing, intention tremor, nystagmus, ataxic gait, cerebellar signs, ' +
    'ptosis, myotonic dystrophy, Charcot–Marie–Tooth, multiple sclerosis, Parkinson’s disease',
  Consultation:
    'sclerodactyly, telangiectasia, Raynaud’s phenomenon, systemic sclerosis, rheumatoid arthritis, ' +
    'ulnar deviation, swan-neck deformity, acromegaly, bitemporal hemianopia, Graves’ disease, ' +
    'thyroid acropachy, methotrexate, hydroxychloroquine, prednisolone, eGFR, HbA1c, creatinine, ' +
    'proteinuria, differential diagnosis, investigations',
  Communication:
    'duty of candour, capacity assessment, best interests, confidentiality, safety-netting, ' +
    'shared decision-making, ideas concerns and expectations, breaking bad news, palliative care, ' +
    'do not attempt resuscitation, second opinion, incident reporting, consultant, multidisciplinary team, ' +
    'follow-up, prognosis, adherence, side effects',
};

/** Fallback when the specialty is unknown or unmapped. */
const GENERAL_GLOSSARY =
  'examination findings, differential diagnosis, investigations, management, ' +
  'hepatosplenomegaly, pan-systolic murmur, peripheral neuropathy, clubbing, ' +
  'prednisolone, eGFR, HbA1c';

export interface DictationContext {
  /** CaseMeta.specialty — client-visible (shown in the picker, implied by the stem). */
  specialty?: string;
  /** The VISIBLE transcript. Hidden case content must never appear here. */
  entries?: { role: 'user' | 'assistant'; content: string }[];
}

/** Strip in-chat image markers and collapse whitespace — the prompt should
 *  read like plain preceding speech. */
function clean(text: string): string {
  return text
    .replace(/\{\{IMG:[^}]*\}\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The last `budget` chars, advanced to the next word boundary so the prompt
 *  never opens on a half-word (a fragment would bias toward a non-word). */
function tailOf(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.slice(text.length - budget);
  const firstSpace = cut.indexOf(' ');
  return firstSpace > 0 ? cut.slice(firstSpace + 1) : cut;
}

/**
 * Build the bias prompt for the next dictation turn. Returns a string within
 * MAX_STT_PROMPT_CHARS (the server truncates too, but do it here so the tail
 * we drop is the one we chose to drop).
 */
export function buildDictationPrompt(ctx: DictationContext): string {
  const glossary =
    (ctx.specialty && GLOSSARIES[ctx.specialty]) || GENERAL_GLOSSARY;

  // The transcript tail — the last few turns in CHRONOLOGICAL order, so the
  // prompt ends with whatever the candidate has just heard (usually the
  // examiner's latest reply). That is what "preceding transcript" means to
  // whisper, and the end of the window is where attention concentrates.
  // '[BEGIN ENCOUNTER]' is a control token, not speech.
  const entries = (ctx.entries ?? []).filter(
    (e) => e.content && !e.content.startsWith('[BEGIN')
  );
  const recent = entries.slice(-3).map((e) => clean(e.content)).filter(Boolean);
  const tail = tailOf(recent.join(' ').trim(), TAIL_BUDGET);

  const head = `${PRIMER} Glossary: ${glossary}.`;
  const headBudget = MAX_STT_PROMPT_CHARS - (tail ? tail.length + 1 : 0);
  const trimmedHead =
    head.length <= headBudget
      ? head
      : // Drop whole glossary terms rather than truncating one mid-word (a
        // half-word would bias toward a non-word).
        `${PRIMER} Glossary: ${glossary
          .split(', ')
          .reduce<string[]>((kept, term) => {
            const next = [...kept, term];
            if (`${PRIMER} Glossary: ${next.join(', ')}.`.length <= headBudget) return next;
            return kept;
          }, [])
          .join(', ')}.`;

  return [trimmedHead, tail].filter(Boolean).join(' ').slice(0, MAX_STT_PROMPT_CHARS);
}
