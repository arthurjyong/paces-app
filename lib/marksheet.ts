// Marksheet validation shared by the forced-tool-use path (app/api/examiner on
// providers that honour tool_choice), the strict-JSON path (providers that
// don't — Moonshot/MiniMax — and the dev-only CLI bridge in lib/devCli.ts).
// Only the case's marked skills count, each at most once; total/maxTotal are
// recomputed, never trusted from the model.

import type { CaseMeta, Grade, MarkSheet, SkillId, SkillMark } from './types';

/**
 * Marking instruction for the strict-JSON path (providers without forced
 * tool_choice + the dev CLI bridge). Output is validated by buildMarkSheet —
 * the instruction and validator must stay in sync.
 */
export function markInstruction(meta: CaseMeta): string {
  return `The encounter is over. Complete the marksheet now, based strictly on the transcript above and graded per the marking rubric.
Respond with ONLY a JSON object — no prose, no code fences — of exactly this shape:
{"skills":[{"skill":"A","grade":2,"justification":"..."}],"overallImpression":"...","biggestImprovement":"..."}
Rules: one "skills" entry per marked skill — this encounter marks exactly: ${meta.skills.join(', ')}. "grade" is an integer: 2 = Satisfactory, 1 = Borderline, 0 = Unsatisfactory. Every Borderline or Unsatisfactory needs a one-line justification tied to the rubric descriptors. "biggestImprovement" names the single change that would most improve the weakest skill.`;
}

/** Pull the outermost JSON object out of a possibly fenced / prefixed reply. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Validate a model-produced marksheet payload into a MarkSheet, or explain why not. */
export function buildMarkSheet(raw: unknown, meta: CaseMeta): MarkSheet | { error: string } {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    skills?: unknown;
    overallImpression?: unknown;
    biggestImprovement?: unknown;
  };

  const allowed = new Set<SkillId>(meta.skills);
  const seen = new Set<SkillId>();
  const skills: SkillMark[] = [];
  if (Array.isArray(input.skills)) {
    for (const item of input.skills) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as { skill?: unknown; grade?: unknown; justification?: unknown };
      const skill = entry.skill as SkillId;
      if (!allowed.has(skill) || seen.has(skill)) continue;
      const grade = entry.grade;
      if (grade !== 0 && grade !== 1 && grade !== 2) continue;
      seen.add(skill);
      skills.push({
        skill,
        grade: grade as Grade,
        justification: typeof entry.justification === 'string' ? entry.justification : '',
      });
    }
  }
  if (skills.length === 0) {
    return { error: 'The examiner returned an empty marksheet — try again' };
  }
  if (skills.length !== meta.skills.length) {
    // Every marked skill must have a graded, justified row — a partial
    // marksheet would silently zero the missing skills in the total.
    return { error: 'The examiner returned an incomplete marksheet — try again' };
  }

  return {
    skills,
    total: skills.reduce((sum, s) => sum + s.grade, 0),
    maxTotal: meta.skills.length * 2,
    overallImpression:
      typeof input.overallImpression === 'string' ? input.overallImpression : '',
    biggestImprovement:
      typeof input.biggestImprovement === 'string' ? input.biggestImprovement : '',
  };
}
