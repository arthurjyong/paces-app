#!/usr/bin/env node
// Agent A — content pipeline for the PACES AI-examiner MVP.
// Reads the corpus (parent of the app root) and emits content/ in the app root.
// Plain Node ESM, no deps. Idempotent: wipes and rebuilds content/ on every run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- paths ----------
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_ROOT = path.resolve(APP_ROOT, '..');
const SRC_CASES = path.join(CORPUS_ROOT, '5_Carousels_PACES23', 'Carousels', '_enriched');
const SRC_CANONICAL = path.join(CORPUS_ROOT, '_index', 'canonical');
const SRC_MASTER_INDEX = path.join(CORPUS_ROOT, '_index', 'MASTER_INDEX.json');
const SRC_RUBRIC = path.join(CORPUS_ROOT, '5_Carousels_PACES23', 'MARKING_RUBRIC_PACES23.md');

const OUT = path.join(APP_ROOT, 'content');
const OUT_CASES = path.join(OUT, 'cases');
const OUT_CANONICAL = path.join(OUT, 'canonical');

// ---------- small helpers ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fail(msg) {
  console.error(`\nBUILD FAILED: ${msg}`);
  process.exit(1);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a comma-separated inline YAML list, respecting (), [] nesting and quotes. */
function splitInlineList(body) {
  const items = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items.filter(Boolean);
}

function stripQuotes(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** Extract the "## Candidate stem" section (prefix match) up to the next "## " heading. */
function extractStem(md) {
  const lines = md.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## Candidate stem')) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

// ---------- wipe & recreate content/ ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT_CASES, { recursive: true });
fs.mkdirSync(OUT_CANONICAL, { recursive: true });

// ---------- canonical notes ----------
const canonicalFiles = fs.readdirSync(SRC_CANONICAL).filter((f) => f.endsWith('.md')).sort();
// slug -> { terms: string[] } terms = condition + aliases (>= 6 chars), lowercased
const canonicalTerms = new Map();

for (const file of canonicalFiles) {
  const slug = file.replace(/\.md$/, '');
  const raw = fs.readFileSync(path.join(SRC_CANONICAL, file), 'utf8');
  fs.writeFileSync(path.join(OUT_CANONICAL, file), raw); // verbatim copy

  // front matter between the first pair of --- lines
  const lines = raw.split('\n');
  let fmStart = -1;
  let fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (fmStart === -1) fmStart = i;
      else { fmEnd = i; break; }
    }
  }
  const terms = new Set();
  if (fmStart !== -1 && fmEnd !== -1) {
    const fm = lines.slice(fmStart + 1, fmEnd);
    for (let i = 0; i < fm.length; i++) {
      const line = fm[i];
      const condMatch = line.match(/^condition:\s*(.+)$/);
      if (condMatch) terms.add(stripQuotes(condMatch[1]));
      const aliasInline = line.match(/^aliases:\s*\[(.*)\]\s*$/);
      if (aliasInline) {
        for (const a of splitInlineList(aliasInline[1])) terms.add(stripQuotes(a));
      } else if (/^aliases:\s*$/.test(line)) {
        // block-style list: "- item" lines until the next key
        for (let j = i + 1; j < fm.length; j++) {
          const m = fm[j].match(/^\s*-\s+(.+)$/);
          if (!m) break;
          terms.add(stripQuotes(m[1]));
        }
      }
    }
  }
  const usable = [...terms].map((t) => t.toLowerCase()).filter((t) => t.length >= 6);
  canonicalTerms.set(slug, usable);
}

if (canonicalFiles.length !== 156) {
  console.warn(`WARNING: expected 156 canonical notes, found ${canonicalFiles.length}`);
}

// ---------- rubric ----------
fs.writeFileSync(path.join(OUT, 'rubric.md'), fs.readFileSync(SRC_RUBRIC, 'utf8'));

// ---------- kb_lookup.json from MASTER_INDEX.json topic_lookup ----------
const masterIndex = JSON.parse(fs.readFileSync(SRC_MASTER_INDEX, 'utf8'));
const topicLookup = masterIndex.topic_lookup || {};
/** @type {Record<string, string[]>} */
const kbLookup = {};
for (const [term, refs] of Object.entries(topicLookup)) {
  if (!Array.isArray(refs)) continue;
  const slugs = [];
  for (const ref of refs) {
    if (ref && ref.corpus === 'canonical' && typeof ref.file === 'string') {
      const slug = path.basename(ref.file).replace(/\.md$/, '');
      if (!slugs.includes(slug)) slugs.push(slug);
    }
  }
  if (slugs.length > 0) kbLookup[term.toLowerCase()] = slugs;
}
fs.writeFileSync(path.join(OUT, 'kb_lookup.json'), JSON.stringify(kbLookup, null, 1));

// ---------- cases ----------
const FALLBACK_SKILLS = {
  examination: ['A', 'B', 'D', 'E', 'G'],
  communication: ['C', 'E', 'F', 'G'],
  consultation: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
};
const TIMING = {
  examination: '6 min exam + 4 min Q&A',
  communication: '5 min reading + 10 min',
  consultation: '5 min reading + 15 min + 5 min Q&A',
};

function sittingLabelFrom(sitting) {
  // e.g. "2024-03_CGH_Cx" -> "CGH · Mar 2024"; "2025-10_KTPH_AM" -> "KTPH · Oct 2025 · AM"
  const m = sitting.match(/^(\d{4})-(\d{2})_([A-Za-z]+)_(\w+)$/);
  if (!m) fail(`unrecognised sitting dir name: ${sitting}`);
  const [, year, month, hospital, rawSuffix] = m;
  const mon = MONTHS[parseInt(month, 10) - 1];
  if (!mon) fail(`bad month in sitting dir name: ${sitting}`);
  let suffix = '';
  if (rawSuffix === 'Cx') suffix = '';
  else if (/^Cycle(\d+)$/.test(rawSuffix)) suffix = ` · Cycle ${rawSuffix.match(/^Cycle(\d+)$/)[1]}`;
  else if (rawSuffix === 'AM' || rawSuffix === 'PM') suffix = ` · ${rawSuffix}`;
  else fail(`unrecognised sitting suffix "${rawSuffix}" in ${sitting}`);
  return `${hospital} · ${mon} ${year}${suffix}`;
}

/** Parse the skills token from the line-2 blockquote; returns SkillId[] or null. */
function parseSkillsLine(line2) {
  if (!line2 || !line2.startsWith('>')) return null;
  const m = line2.match(/skills:\s*(.*)$/);
  if (!m) return null;
  const token = m[1].split(' · ')[0].trim();
  if (!token) return null;
  const range = token.match(/^([A-G])\s*[–—-]\s*([A-G])/);
  if (range) {
    const from = range[1].charCodeAt(0);
    const to = range[2].charCodeAt(0);
    if (to < from) return null;
    return Array.from({ length: to - from + 1 }, (_, i) => String.fromCharCode(from + i));
  }
  const letters = token.split('·').map((s) => s.trim());
  if (letters.length === 0 || !letters.every((l) => /^[A-G]$/.test(l))) return null;
  return letters;
}

const PLACEHOLDER_STEM = (specialty) => `## Candidate stem  (read aloud)
**No past-year recall exists for this encounter slot.** This is a deliberate free-pick placeholder kept so the carousel remains a complete 8-station loop — no specific case was recorded by candidates for this ${specialty.toLowerCase()} encounter, and none has been invented.

To practise this slot, run any standard ${specialty.toLowerCase()} scenario of your choice from your own case bank, or simply pick a different case from the case picker.
`;

const sittings = fs
  .readdirSync(SRC_CASES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const cases = [];
const stemFailures = [];
const injectedPlaceholders = [];
const skillsMismatches = [];
const matchStats = {}; // encounterType -> { total, matched }

for (const sitting of sittings) {
  const sittingLabel = sittingLabelFrom(sitting);
  const files = fs.readdirSync(path.join(SRC_CASES, sitting)).filter((f) => f.endsWith('.md')).sort();
  for (const file of files) {
    const fm = file.match(/^(\d+)_Station(\d+)_([A-Za-z]+)\.md$/);
    if (!fm) fail(`unrecognised case filename: ${sitting}/${file}`);
    const encounterNo = parseInt(fm[1], 10);
    const station = parseInt(fm[2], 10);
    const specialty = fm[3];
    const encounterType =
      specialty === 'Communication' ? 'communication' : specialty === 'Consultation' ? 'consultation' : 'examination';

    let raw = fs.readFileSync(path.join(SRC_CASES, sitting, file), 'utf8');
    const srcLines = raw.split('\n');
    const h1 = srcLines[0] || '';
    const firstBlockquote = srcLines.find((l) => l.startsWith('> ')) || '';

    // --- stem (validation; inject a synthetic stem ONLY for declared placeholder slots) ---
    let stem = extractStem(raw);
    if (stem === null && /placeholder/i.test(firstBlockquote)) {
      // Free-pick placeholder slot (no past-year recall): synthesise a stem in the COPY
      // so every served case has a candidate-visible stem. Source corpus is untouched.
      const lines = raw.split('\n');
      let insertAt = lines.findIndex((l) => l.startsWith('## '));
      if (insertAt === -1) insertAt = lines.length;
      lines.splice(
        insertAt,
        0,
        '<!-- stem synthesized by scripts/build-content.mjs: placeholder slot had no Candidate stem in the source -->',
        ...PLACEHOLDER_STEM(specialty).split('\n')
      );
      raw = lines.join('\n');
      stem = extractStem(raw);
      injectedPlaceholders.push(`${sitting}/${file}`);
    }
    if (stem === null || stem.length === 0) {
      stemFailures.push(`${sitting}/${file}`);
    }

    // --- skills ---
    const fallback = FALLBACK_SKILLS[encounterType];
    const parsedSkills = parseSkillsLine(srcLines[1]);
    const skills = parsedSkills ?? fallback;
    if (!parsedSkills) {
      skillsMismatches.push(`${sitting}/${file}: no parseable skills line, used fallback ${fallback.join('')}`);
    } else if (parsedSkills.join('') !== fallback.join('')) {
      skillsMismatches.push(`${sitting}/${file}: parsed ${parsedSkills.join('')} != expected ${fallback.join('')}`);
    }

    // --- canonical matching: H1 title + first blockquote line ---
    const matchText = `${h1.replace(/^#\s*/, '')}\n${firstBlockquote.replace(/^>\s*/, '')}`.toLowerCase();
    const scored = [];
    for (const [slug, terms] of canonicalTerms) {
      let best = 0;
      for (const term of terms) {
        if (term.length <= best) continue;
        const re = new RegExp(`(?<![a-z0-9])${escapeRegex(term)}(?![a-z0-9])`, 'i');
        if (re.test(matchText)) best = term.length;
      }
      if (best > 0) scored.push({ slug, score: best });
    }
    scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
    const canonicalSlugs = scored.slice(0, 3).map((s) => s.slug);

    matchStats[encounterType] = matchStats[encounterType] || { total: 0, matched: 0 };
    matchStats[encounterType].total++;
    if (canonicalSlugs.length > 0) matchStats[encounterType].matched++;

    // --- emit case copy + manifest entry ---
    const outName = `${sitting}__${file}`;
    fs.writeFileSync(path.join(OUT_CASES, outName), raw);

    cases.push({
      id: `${sitting}__${encounterNo}`,
      sitting,
      sittingLabel,
      encounterNo,
      station,
      specialty,
      encounterType,
      skills,
      timing: TIMING[encounterType],
      displayTitle: `Station ${station} · ${specialty}`,
      file: outName,
      canonicalSlugs,
    });
  }
}

cases.sort((a, b) => a.sitting.localeCompare(b.sitting) || a.encounterNo - b.encounterNo);

const manifest = {
  builtAt: new Date().toISOString(),
  caseCount: cases.length,
  cases,
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

// ---------- report ----------
console.log('=== build-content.mjs report ===');
console.log(`cases:            ${cases.length} (expected 296)`);
console.log(`canonical notes:  ${canonicalFiles.length} (expected 156)`);
console.log(`kb terms:         ${Object.keys(kbLookup).length}`);
console.log(`stem failures:    ${stemFailures.length}`);
if (stemFailures.length) for (const f of stemFailures) console.log(`  MISSING STEM: ${f}`);
console.log(`placeholder stems injected (no recall slots): ${injectedPlaceholders.length}`);
for (const f of injectedPlaceholders) console.log(`  injected: ${f}`);
console.log(`skills-line mismatches vs fallback (informational): ${skillsMismatches.length}`);
for (const f of skillsMismatches) console.log(`  ${f}`);
console.log('canonical match-rate by encounterType:');
for (const [type, s] of Object.entries(matchStats)) {
  console.log(`  ${type}: ${s.matched}/${s.total} (${((100 * s.matched) / s.total).toFixed(1)}%)`);
}
console.log('sample manifest entries:');
for (const c of [cases.find((c) => c.encounterType === 'examination'), cases.find((c) => c.encounterType === 'communication'), cases.find((c) => c.encounterType === 'consultation')]) {
  console.log(JSON.stringify(c));
}

if (cases.length !== 296) fail(`case count ${cases.length} !== 296`);
if (canonicalFiles.length !== 156) fail(`canonical count ${canonicalFiles.length} !== 156`);
if (stemFailures.length > 0) fail(`${stemFailures.length} case file(s) without a non-empty Candidate stem (listed above)`);
console.log('OK');
