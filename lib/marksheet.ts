// Marksheet validation shared by the Anthropic tool-use path (app/api/examiner)
// and the dev-only CLI bridge (lib/devCli.ts). Only the case's marked skills
// count, each at most once; total/maxTotal are recomputed, never trusted from
// the model.

import type { CaseMeta, Grade, MarkSheet, SkillId, SkillMark } from './types';

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
