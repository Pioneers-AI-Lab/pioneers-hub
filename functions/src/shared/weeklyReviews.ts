import { isNote, isWholeNote } from "./background";
import { shiftWeek } from "./dates";
import { RuleError, setWrite, type DocWrite } from "./docWrites";
import { reachesMax, withOutstanding } from "./scoringRules";
import { mean, roundTo, weightedMean, type FounderReview, type StartupReview, type StartupReviewCriterion } from "./types";

// ----------------------------
// La revue des Weekly updates (lot 4, docs/FONCTIONNALITES.md §2.8, §2.9, §3.2)
// ----------------------------
// Admin > Reviews : pour une semaine, le staff revoit chaque Weekly update founder (grille oui / non)
// et chaque Weekly update startup (Traction 60, Progress 40, Outstanding +20 seulement a 100),
// une reponse apres l'autre. Stockage staff + investors IC (types/review.ts), ecrit par le staff
// seul (firestore.rules `founderReviews`, `startupReviews`, miroir shared/access.ts#canReadWeeklyReviews).
// Logique pure : la page, les regles (memes bornes) et le moteur de scores lisent les memes regles.
//
// Ce que les revues donnent aux scores (shared/scoring.ts, services/scores.ts) :
//   Weekly goal        milestone : moyenne des semaines notees ; une semaine vaut 100 si l'objectif
//                      de la semaine PRECEDENTE a ete juge assez ambitieux (revue d'avant) ET qu'il
//                      est atteint (revue de la semaine), 0 sinon (`weeklyGoalScore`)
//   Problem validated  milestone : atteinte des qu'une revue dit oui, et le reste (`problemValidatedOf`)
//   Traction (startup) signal « Weekly updates » : moyenne des notes de ses revues (`weeklyTractionOf`)

/** Les collections (`collections.ts` ne se touche pas dans ce lot : noms declares ici). */
export const FOUNDER_REVIEWS_COLLECTION = "founderReviews";
export const STARTUP_REVIEWS_COLLECTION = "startupReviews";
/** Une revue par fondateur (ou startup) et par semaine : son id et le lundi de la semaine. */
export const founderReviewPath = (founderId: string, weekStartDayString: string) => `${FOUNDER_REVIEWS_COLLECTION}/${founderId}_${weekStartDayString}`;
export const startupReviewPath = (startupId: string, weekStartDayString: string) => `${STARTUP_REVIEWS_COLLECTION}/${startupId}_${weekStartDayString}`;

// ---- Grille Weekly founder (oui / non) ------------------------------------------------

/** Les trois questions, dans l'ordre de la grille. */
export const FOUNDER_REVIEW_QUESTIONS = [
  { key: "goalAmbitious", label: "Is this goal ambitious enough?", hint: "The goal for next week, in this update." },
  { key: "goalReached", label: "Was last week's goal reached?", hint: "The goal given last week, shown above the answer." },
  { key: "problemValidated", label: "Problem validated?", hint: "At least 10 conversations with potential users on one problem, with proofs. Once yes, it stays reached." },
] as const satisfies readonly { key: keyof FounderReview; label: string; hint: string }[];

export type FounderReviewAnswers = Pick<FounderReview, "goalAmbitious" | "goalReached" | "problemValidated">;

/** Ce que le staff enregistre pour un fondateur et une semaine. */
export type FounderReviewInput = Pick<FounderReview, "programId" | "batchId" | "founderId" | "weekStartDayString" | "comment"> & FounderReviewAnswers;

/** Ce qui empeche d'enregistrer (vide si rien) : au moins une reponse. */
export const founderReviewProblems = (answers: FounderReviewAnswers): string[] =>
  FOUNDER_REVIEW_QUESTIONS.some((q) => typeof answers[q.key] === "boolean") ? [] : ["Answer at least one question."];

/** La revue d'un Weekly update founder, a ecrire en entier (le dernier enregistrement fait foi). */
export function founderReviewWrite(input: FounderReviewInput, reviewedByUid: string, nowISO: string): DocWrite {
  const problem = founderReviewProblems(input)[0];
  if (problem) throw new RuleError("invalid_review", problem, "goalAmbitious");
  const review: FounderReview = { ...input, comment: input.comment?.trim() || null, reviewedByUid, reviewedDateISOString: nowISO };
  return setWrite(founderReviewPath(input.founderId, input.weekStartDayString), review);
}

// ---- Grille Weekly startup (Traction 60, Progress 40) -----------------------------------

export const WEEKLY_REVIEW_MAX_NOTE = 5;
/** Le maximum de la note avant l'Outstanding : la somme des points. */
const STARTUP_REVIEW_MAX = 100;

export const STARTUP_REVIEW_CRITERIA: readonly { key: StartupReviewCriterion; label: string; points: number; definition: string }[] = [
  { key: "traction", label: "Traction", points: 60, definition: "The numbers and their quality." },
  { key: "progress", label: "Progress", points: 40, definition: "Last week's goals reached." },
];

export type StartupReviewScores = StartupReview["scores"];

/**
 * La note sur 100, avant l'Outstanding : note ÷ 5 × points (comme shared/background.ts#backgroundBase,
 * mais sans redistribution : `null` tant que les deux criteres ne sont pas notes).
 */
export function startupReviewBase(scores: StartupReviewScores): number | null {
  if (!STARTUP_REVIEW_CRITERIA.every((c) => isNote(scores[c.key]))) return null;
  return roundTo(weightedMean(STARTUP_REVIEW_CRITERIA.map((c) => [(scores[c.key]! / WEEKLY_REVIEW_MAX_NOTE) * STARTUP_REVIEW_MAX, c.points] as const))!, 2);
}

/** L'Outstanding mention se donne seulement a 100 (les deux criteres a 5). */
export const canStartupReviewBeOutstanding = (scores: StartupReviewScores): boolean => {
  const base = startupReviewBase(scores);
  return base !== null && reachesMax(base, STARTUP_REVIEW_MAX);
};

/** LA note d'un Weekly update startup, de 0 a 120 (+20 avec l'Outstanding, ignoree sous 100) ; `null` si incomplete. */
export function startupReviewNote(review: Pick<StartupReview, "scores" | "outstanding">): number | null {
  const base = startupReviewBase(review.scores);
  return base === null ? null : withOutstanding(base, STARTUP_REVIEW_MAX, review.outstanding === true);
}

/** Ce qui empeche d'enregistrer (vide si rien) : chaque critere un entier de 0 a 5, l'Outstanding seulement a 100. */
export function startupReviewProblems(scores: StartupReviewScores, outstanding: boolean): string[] {
  const problems: string[] = [];
  for (const c of STARTUP_REVIEW_CRITERIA) {
    const v = scores[c.key];
    if (!isWholeNote(v, WEEKLY_REVIEW_MAX_NOTE)) problems.push(`${c.label}: a score from 0 to ${WEEKLY_REVIEW_MAX_NOTE}.`);
  }
  if (problems.length === 0 && outstanding && !canStartupReviewBeOutstanding(scores)) {
    problems.push("The Outstanding mention is only given at 100.");
  }
  return problems;
}

export type StartupReviewInput = Pick<StartupReview, "programId" | "batchId" | "startupId" | "weekStartDayString" | "scores" | "outstanding" | "comment">;

/** La revue d'un Weekly update startup, a ecrire en entier. Refuse (RuleError) une note invalide. */
export function startupReviewWrite(input: StartupReviewInput, reviewedByUid: string, nowISO: string): DocWrite {
  const problem = startupReviewProblems(input.scores, input.outstanding)[0];
  if (problem) throw new RuleError("invalid_review", problem, "scores");
  const review: StartupReview = {
    ...input,
    scores: Object.fromEntries(STARTUP_REVIEW_CRITERIA.map((c) => [c.key, input.scores[c.key] ?? null])),
    comment: input.comment?.trim() || null,
    reviewedByUid,
    reviewedDateISOString: nowISO,
  };
  return setWrite(startupReviewPath(input.startupId, input.weekStartDayString), review);
}

// ---- Ce que les revues donnent aux scores ---------------------------------------------------

/**
 * La milestone Weekly goal d'un fondateur, sur 100 : la moyenne des semaines notees. Une semaine W
 * compte quand sa revue dit si l'objectif de W-1 est atteint ET que la revue de W-1 a dit s'il etait
 * assez ambitieux : 100 si les deux sont oui, 0 sinon. `null` sans aucune semaine notee (pas de poids).
 */
export function weeklyGoalScore(reviews: readonly Pick<FounderReview, "weekStartDayString" | "goalAmbitious" | "goalReached">[]): number | null {
  const byWeek = new Map(reviews.map((r) => [r.weekStartDayString, r]));
  const weeks = reviews.flatMap((r) => {
    const ambitious = byWeek.get(shiftWeek(r.weekStartDayString, -1))?.goalAmbitious;
    if (typeof r.goalReached !== "boolean" || typeof ambitious !== "boolean") return [];
    return [ambitious && r.goalReached ? 100 : 0];
  });
  const score = mean(weeks);
  return score === null ? null : roundTo(score, 1);
}

/** La milestone Problem validated : oui des qu'une revue le dit ; non si des revues ont repondu sans oui ; `null` sans reponse. */
export function problemValidatedOf(reviews: readonly Pick<FounderReview, "problemValidated">[]): boolean | null {
  if (reviews.some((r) => r.problemValidated === true)) return true;
  return reviews.some((r) => r.problemValidated === false) ? false : null;
}

/** Le signal « Weekly updates » de la Traction d'une startup : la moyenne de ses notes (0-120) ; `null` sans revue notee. */
export function weeklyTractionOf(reviews: readonly Pick<StartupReview, "scores" | "outstanding">[]): number | null {
  const notes = reviews.flatMap((r) => startupReviewNote(r) ?? []);
  const m = mean(notes);
  return m === null ? null : roundTo(m, 1);
}
