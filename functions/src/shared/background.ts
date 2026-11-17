import { docPaths } from "./collections";
import { mergeWrite, RuleError, type DocWrite } from "./docWrites";
import { OUTSTANDING_BONUS_POINTS, pointsOn100, reachesMax, withOutstanding } from "./scoringRules";
import type { FounderBackground, FounderBackgroundProposal } from "./types";

// ----------------------------
// La grille Background (lot 2, docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §2.13)
// ----------------------------
// Notee une fois par le staff a l'onboarding (Admin > Background), sur le profil :
// quatre criteres de 0 a 5 et leurs points (40 / 25 / 20 / 15 = 100, `BACKGROUND_CRITERIA`),
// plus l'Outstanding mention (+20, seulement a 100 : la note monte alors a 120 ; meme regle
// que le bareme d'un hackathon, shared/scoringRules.ts#withOutstanding).
// Stockee dans `founders/{id}/private/internal` (staff + investors IC), champ
// `background` : `scores` (la note validee, la seule comptee), `outstanding`,
// `ratedByUid`, `ratedDateISOString` ; `background.proposed` = la proposition de
// Claude (scripts/background-draft.mjs), meme forme, jamais comptee.
// Logique pure : la page d'Admin, le script et le moteur de scores (shared/scoring.ts)
// lisent les memes regles.

/** Les quatre criteres de la grille. */
export type BackgroundCriterion = "execution" | "founderSignal" | "pedigree" | "geography";

/** La note maximale d'un critere. */
export const BACKGROUND_MAX_NOTE = 5;
/** Le maximum de la note avant l'Outstanding : la somme des points. */
const BACKGROUND_MAX = 100;
/** Ce que rapporte l'Outstanding mention, a une note de 100 (+20 % du maximum, comme un hackathon). */
export const BACKGROUND_OUTSTANDING_BONUS = OUTSTANDING_BONUS_POINTS;

/**
 * Les criteres, dans l'ordre de la grille, avec leurs points (40 / 25 / 20 / 15 = 100) et leur
 * definition (affichee au staff et donnee a Claude). Geography : definition de la grille
 * Pioneers encore a reprendre (§4.7).
 */
export const BACKGROUND_CRITERIA: readonly { key: BackgroundCriterion; label: string; points: number; definition: string | null }[] = [
  { key: "execution", label: "Execution", points: 40, definition: "What they have built, shipped and led." },
  { key: "founderSignal", label: "Founder signal", points: 25, definition: "A company already started, side projects, risks taken." },
  { key: "pedigree", label: "Pedigree", points: 20, definition: "Schools, notable companies." },
  { key: "geography", label: "Geography", points: 15, definition: null },
];

/** Une note complete : les quatre criteres. */
export type BackgroundScores = Record<BackgroundCriterion, number>;

/** Une note de critere renseignee (un nombre). */
export const isNote = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * La note sur 100, avant l'Outstanding : chaque critere rapporte note ÷ 5 × ses points.
 * Un critere absent est retire et les autres se partagent son poids (« sans note,
 * pas de poids ») ; `null` si aucun critere n'est note.
 */
export const backgroundBase = (scores: Partial<Record<BackgroundCriterion, number | null>>): number | null =>
  pointsOn100(BACKGROUND_CRITERIA, scores, BACKGROUND_MAX_NOTE);

/** L'Outstanding mention se donne seulement a une note de 100 (tous les criteres notes a 5). */
export const canBeOutstanding = (scores: Partial<Record<BackgroundCriterion, number | null>>): boolean => {
  const base = backgroundBase(scores);
  return base !== null && reachesMax(base, BACKGROUND_MAX);
};

/**
 * LA note Background, de 0 a 120 : la note sur 100, plus 20 avec l'Outstanding mention
 * (ignoree sous 100). `null` si aucun critere n'est note. Le moteur de scores l'importe.
 */
export function backgroundScore(scores: Partial<Record<BackgroundCriterion, number | null>>, outstanding: boolean): number | null {
  const base = backgroundBase(scores);
  return base === null ? null : withOutstanding(base, BACKGROUND_MAX, outstanding);
}

/** La note validee du staff (`background.scores`), sur 120 ; `null` sans note (une proposition seule ne compte pas). */
export const ratedBackgroundScore = (background: FounderBackground | null | undefined): number | null =>
  background ? backgroundScore(background.scores ?? {}, background.outstanding === true) : null;

/** La note a ete enregistree par le staff : ses quatre criteres sont notes. */
export const isBackgroundRated = (background: FounderBackground | null | undefined): boolean =>
  BACKGROUND_CRITERIA.every((c) => isNote(background?.scores?.[c.key]));

/**
 * Ce qui empeche d'enregistrer une note (vide si rien) : chaque critere est un entier
 * de 0 a 5, et l'Outstanding n'est donnee qu'a 100. Lue par la page et par le script.
 */
export function backgroundProblems(scores: Partial<Record<BackgroundCriterion, unknown>>, outstanding: boolean): string[] {
  const problems: string[] = [];
  for (const c of BACKGROUND_CRITERIA) {
    const v = scores[c.key];
    if (!isNote(v) || !Number.isInteger(v) || v < 0 || v > BACKGROUND_MAX_NOTE) problems.push(`${c.label}: a score from 0 to ${BACKGROUND_MAX_NOTE}.`);
  }
  if (problems.length === 0 && outstanding && !canBeOutstanding(scores as BackgroundScores)) {
    problems.push("The Outstanding mention is only given at 100.");
  }
  return problems;
}

/**
 * La note du staff, a fusionner dans `founders/{id}/private/internal` : seuls `scores`,
 * `outstanding`, `ratedByUid` et `ratedDateISOString` ; la proposition (`proposed`) reste.
 * Refuse (RuleError) une note invalide (`backgroundProblems`).
 */
export function backgroundRatingWrite(
  founderId: string,
  rating: { scores: BackgroundScores; outstanding: boolean },
  ratedByUid: string,
  nowISO: string,
): DocWrite {
  const problem = backgroundProblems(rating.scores, rating.outstanding)[0];
  if (problem) throw new RuleError("invalid_background", problem, "scores");
  return mergeWrite(docPaths.founderInternal(founderId), {
    background: { scores: { ...rating.scores }, outstanding: rating.outstanding, ratedByUid, ratedDateISOString: nowISO },
  });
}

/**
 * La proposition a fusionner dans `private/internal` : `background.proposed` SEULEMENT,
 * jamais `background.scores` (la note du staff, absente tant qu'il n'a pas note).
 */
export function backgroundProposalWrite(
  founderId: string,
  proposal: Omit<FounderBackgroundProposal, "ratedDateISOString">,
  nowISO: string,
): DocWrite {
  const proposed: FounderBackgroundProposal = { ...proposal, ratedDateISOString: nowISO };
  return mergeWrite(docPaths.founderInternal(founderId), { background: { proposed } });
}
