import { RuleError } from "../docWrites";
import { criterionKeyOf, getFieldDef } from "../fieldRegistry";
import { ratingScale } from "../formRules";
import { juryCriteria } from "../forms";
import { compareTeamPoints, scoredTeamOf, scoreTeams } from "../scoringRules";
import { activeQuestions, answerKey, isJuryForm, scoringOf, type Evaluation, type EventScoring, type Form, type FormAnswer, type Submission } from "../types";

// ----------------------------
// Noter un jury avec Claude (staff, decision du 18/11)
// ----------------------------
// Le staff fait remplir par Claude le formulaire de jury d'un evenement : Claude
// lit chaque cible (ce que lit un jure : `loadJuryBrief`), note, et rend UNE
// table ; le staff la valide, et les notes partent par LE chemin du formulaire
// (`submitFormResponse`, sous le nom complet du staff : le meme jure que par le
// lien, une seule voix). Ce fichier ne porte que ce qui est propre a Claude :
// les reponses du formulaire tirees de ses notes (justifications par critere
// repliees dans le commentaire), et la table de l'apercu, calculee comme le
// leaderboard (`scoredTeamOf`, `scoreTeams`, `compareTeamPoints`).

type JuryForm = Pick<Form, "questions" | "identityCheck" | "archivedDateISOString">;

/** Les autres questions du formulaire de jury, ecrites sur l'evaluation. */
const EXTRA_FIELDS = ["overallScore", "decision", "wouldInvest", "betLikelihood"] as const;
type ExtraField = (typeof EXTRA_FIELDS)[number];

/** Le formulaire de jury d'un evenement : identite `jury_link`, non archive, avec une grille. */
export const juryFormOf = <F extends JuryForm>(forms: readonly F[]): F | null =>
  forms.find((f) => f.archivedDateISOString === null && isJuryForm(f) && juryCriteria([f]).length > 0) ?? null;

/**
 * La grille d'un formulaire de jury : ses criteres (`juryCriteria`, la grille du
 * leaderboard) avec leur definition, et ses autres questions (avec leur echelle
 * ou leurs choix) ; `commentMax` : la place du commentaire (registre des champs).
 */
export function juryGridOf(form: JuryForm) {
  const questions = activeQuestions(form);
  const questionOf = (key: string) => questions.find((q) => criterionKeyOf(q.dbField) === key)!;
  const criteria = juryCriteria([form]).map((c) => {
    const q = questionOf(c.key);
    return { ...c, questionId: q.id, description: q.description, required: q.required };
  });
  const extras = questions.flatMap((q) => {
    const field = q.dbField?.startsWith("evaluation.") ? (q.dbField.slice("evaluation.".length) as ExtraField) : null;
    if (!field || !(EXTRA_FIELDS as readonly string[]).includes(field)) return [];
    return [{ field, questionId: q.id, label: q.label, required: q.required, scale: q.type === "rating" ? ratingScale(q) : null, options: q.options }];
  });
  const commentQuestion = questions.find((q) => q.dbField === "evaluation.comment") ?? null;
  const commentSpec = getFieldDef("evaluation.comment").value;
  const commentMax = (commentSpec.kind === "text" && commentSpec.maxLength) || 1000;
  return { criteria, extras, commentQuestionId: commentQuestion?.id ?? null, commentMax };
}

export type JuryGrid = ReturnType<typeof juryGridOf>;

/** Ce que Claude rend pour une cible. */
export type JuryEntry = {
  targetId: string;
  scores: Record<string, number>;
  /** Une ou deux phrases par critere : ce qui a ete verifie, ce qui manque. */
  rationale?: Record<string, string>;
  comment?: string | null;
} & Partial<Record<ExtraField, number | string | boolean | null>>;

/**
 * Les reponses du formulaire de jury tirees des notes de Claude (`answerKey`
 * question@cible), et la table de l'apercu. Refuse (RuleError) ce qui ne se
 * repondrait pas : cible hors du jury, cible notee deux fois, critere ou question
 * inconnus, note hors echelle, justification sans question de commentaire ou trop
 * longue. Le reste (questions obligatoires, verrou, valeurs) est verifie par le
 * formulaire lui-meme a l'envoi.
 */
export function juryAnswersPlan(input: {
  grid: JuryGrid;
  scoring: Pick<EventScoring, "items" | "tieBreaks"> | null | undefined;
  targets: readonly { id: string; name: string }[];
  entries: readonly JuryEntry[];
  /** Les notes deja donnees (le jure `judgeId` est remplace par ces notes). */
  evaluations: readonly Pick<Evaluation, "evaluatorId" | "targetId" | "scores">[];
  judgeId: string;
  submissions: ReadonlyMap<string, Submission>;
}) {
  const { grid } = input;
  const byKey = new Map(grid.criteria.map((c) => [c.key, c]));
  const asked = new Map(grid.extras.map((x) => [x.field, x]));
  const targetOf = new Map(input.targets.map((t) => [t.id, t]));
  const scored = new Map<string, JuryEntry>();
  const answers: Record<string, FormAnswer> = {};

  input.entries.forEach((entry, i) => {
    const at = `evaluations.${i}`;
    const target = targetOf.get(entry.targetId);
    if (!target) throw new RuleError("not_a_target", `\`${entry.targetId}\` is not scored by this jury (published groups, or the event's startups).`, `${at}.targetId`);
    if (scored.has(entry.targetId)) throw new RuleError("duplicate_target", `${target.name} is scored twice.`, `${at}.targetId`);
    scored.set(entry.targetId, entry);
    for (const [key, value] of Object.entries(entry.scores)) {
      const c = byKey.get(key);
      if (!c) throw new RuleError("unknown_criterion", `\`${key}\` is not a criterion of this jury form (${grid.criteria.map((x) => x.key).join(", ")}).`, `${at}.scores`);
      if (!Number.isInteger(value) || value < c.min || value > c.max) throw new RuleError("invalid_score", `${target.name}, ${c.label}: a whole number from ${c.min} to ${c.max}.`, `${at}.scores.${key}`);
      answers[answerKey(c.questionId, entry.targetId)] = value;
    }
    for (const field of EXTRA_FIELDS) {
      const value = entry[field];
      if (value === undefined || value === null) continue;
      const q = asked.get(field);
      if (!q) throw new RuleError("unknown_question", `This jury form does not ask \`${field}\`.`, `${at}.${field}`);
      answers[answerKey(q.questionId, entry.targetId)] = value as FormAnswer;
    }
    const lines = [
      ...grid.criteria.flatMap((c) => (entry.rationale?.[c.key]?.trim() ? [`${c.label}: ${entry.rationale[c.key].trim()}`] : [])),
      ...(entry.comment?.trim() ? [entry.comment.trim()] : []),
    ];
    if (lines.length === 0) return;
    if (!grid.commentQuestionId) throw new RuleError("no_comment_question", "This jury form has no comment question: the justification cannot be saved. Add one, or leave `rationale` out.", `${at}.rationale`);
    const comment = lines.join("\n");
    if (comment.length > grid.commentMax) {
      throw new RuleError("comment_too_long", `${target.name}: the justification is ${comment.length} characters, ${grid.commentMax} at most. Shorten it.`, `${at}.rationale`);
    }
    answers[answerKey(grid.commentQuestionId, entry.targetId)] = comment;
  });

  // La table, comme le leaderboard : ses notes seules (points et rang), puis avec tous les jures.
  const scoring = input.scoring ? scoringOf({ scoring: input.scoring as EventScoring }) : null;
  const keys = grid.criteria.map((c) => c.key);
  const others = input.evaluations.filter((e) => e.evaluatorId !== input.judgeId);
  const totals = (evaluationsOf: (id: string) => Pick<Evaluation, "scores">[]) => {
    if (!scoring) return null;
    const teams = input.targets.map((t) => scoredTeamOf(t.id, input.submissions.get(t.id), evaluationsOf(t.id), keys));
    return new Map(scoreTeams(scoring, grid.criteria, teams).map((p) => [p.id, p]));
  };
  const yours = totals((id) => (scored.has(id) ? [scored.get(id)!] : []));
  const projected = totals((id) => [...others.filter((e) => e.targetId === id), ...(scored.has(id) ? [scored.get(id)!] : [])]);
  const mine = new Set(input.evaluations.filter((e) => e.evaluatorId === input.judgeId).map((e) => e.targetId));
  const rows = [...scored.values()]
    .sort((a, b) => (scoring && yours ? compareTeamPoints(scoring, yours.get(a.targetId)!, yours.get(b.targetId)!) : 0))
    .map((e, i) => ({
      rank: i + 1,
      team: targetOf.get(e.targetId)!.name,
      scores: Object.fromEntries(grid.criteria.map((c) => [c.label, e.scores[c.key] ?? null])),
      yourPoints: yours?.get(e.targetId)?.total ?? null,
      projectedTotal: projected?.get(e.targetId)?.total ?? null,
      replacesYourScore: mine.has(e.targetId) || undefined,
    }));
  const notScored = input.targets.filter((t) => !scored.has(t.id)).map((t) => t.name);
  return { answers, rows, notScored };
}
