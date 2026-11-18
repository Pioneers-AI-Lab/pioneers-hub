import { juryMeansOf, pointsOn100, reachesMax, scoringFrom, withOutstanding } from "./scoringRules";
import { mean, roundTo, type Criterion, type Evaluation, type EvaluationDecision, type EventScoring } from "./types";

// ----------------------------
// La grille Pitch (lot 5, docs/FONCTIONNALITES.md §2.11, SPECS §4.9)
// ----------------------------
// UNE grille pour tous les pitchs (pitch days, demos, Selection Day, Pre-IC, IC) : la startup se
// suit dans le temps. Les trois familles de la grille Spring 2026 gardent leurs poids (Team 40,
// Speed of execution 40, Market 20), chacune detaillee en criteres notes de 0 a 5 avec leurs points
// (20 / 10 / 10 | 20 / 20 | 6 / 5 / 4 / 3 / 2 = 100 ; famille Team en trois criteres depuis le 18/11 :
// la capacite d'execution, la complementarite des edges intrinseques des fondateurs, leurs edges marche) : un critere rapporte note ÷ 5 × ses points, comme
// un hackathon. Chaque critere est une question du formulaire de jury (`evaluation.scores.<cle>`).
// L'Outstanding mention (+20, seulement a 100) est celle des hackathons : posee par le staff sur
// la Submission de la startup a cet evenement (Admin > Events > Leaderboard, `submission.outstanding`),
// comptee par `withOutstanding` / `reachesMax` (shared/scoringRules.ts).
// Les familles se calculent ici (logique pure : moteur de scores, fiche startup) ; elles se lisent
// aussi sous les anciennes cles de Spring 2026 (`teamQuality`, `speedOfExecution`, `marketPotential`,
// sur 5 : `legacyPitchScores`), pour comparer les deux batchs.

export const PITCH_FAMILIES = ["team", "speed", "market"] as const;
export type PitchFamily = (typeof PITCH_FAMILIES)[number];

/** Chaque famille : son libelle, ses points sur 100, et sa cle Spring 2026 (critere de l'ancienne grille, sur 5). */
export const PITCH_FAMILY_INFO: Record<PitchFamily, { label: string; points: number; legacyKey: string; legacyLabel: string }> = {
  team: { label: "Team", points: 40, legacyKey: "teamQuality", legacyLabel: "Team quality" },
  speed: { label: "Speed of execution", points: 40, legacyKey: "speedOfExecution", legacyLabel: "Speed of execution" },
  market: { label: "Market", points: 20, legacyKey: "marketPotential", legacyLabel: "Market potential" },
};

export type PitchCriterion = { key: string; label: string; family: PitchFamily; points: number };

/** Les dix criteres, dans l'ordre de la grille. `founderMarketFit` garde sa cle (Market edges depuis le 18/11). */
export const PITCH_CRITERIA: readonly PitchCriterion[] = [
  { key: "teamStrength", label: "Team: ability to execute together", family: "team", points: 20 },
  { key: "edgeComplementarity", label: "Edge complementarity: do the founders' intrinsic edges (code, sales, grit, leadership...) complement each other?", family: "team", points: 10 },
  { key: "founderMarketFit", label: "Market edges: what the founders know, have done or can reach in this market", family: "team", points: 10 },
  { key: "progress", label: "Progress: shipped and learned since the last pitch", family: "speed", points: 20 },
  { key: "traction", label: "Traction: customers, revenue, usage, with proofs", family: "speed", points: 20 },
  { key: "clearIdea", label: "Clear idea: problem, customer, solution, why now", family: "market", points: 6 },
  { key: "market", label: "Market: size and growth", family: "market", points: 5 },
  { key: "competition", label: "Competition and differentiation", family: "market", points: 4 },
  { key: "highPotential", label: "High potential: can it become a venture-scale company?", family: "market", points: 3 },
  { key: "businessModel", label: "Business model", family: "market", points: 2 },
];

/** La note maximale d'un critere, et le maximum de la grille avant l'Outstanding. */
const PITCH_MAX_NOTE = 5;
const PITCH_MAX = 100;

/** Les criteres de chaque famille. */
const ofFamily = (family: PitchFamily) => PITCH_CRITERIA.filter((c) => c.family === family);
export const PITCH_CRITERIA_BY_FAMILY: Record<PitchFamily, readonly PitchCriterion[]> = { team: ofFamily("team"), speed: ofFamily("speed"), market: ofFamily("market") };
const PITCH_KEYS = PITCH_CRITERIA.map((c) => c.key);

/** Le nom court d'un critere (avant les deux-points) : bareme, fiche startup. */
export const pitchCriterionShortLabel = (c: PitchCriterion) => c.label.split(":")[0];

/** La grille du formulaire de jury : 0 a 5, poids = points (le leaderboard sans bareme la lit aussi). */
export const PITCH_RUBRIC: Criterion[] = PITCH_CRITERIA.map((c) => ({ key: c.key, label: c.label, min: 0, max: PITCH_MAX_NOTE, weight: c.points }));

/**
 * Le bareme par defaut d'un evenement de pitch : chaque critere a ses points. Le classement se lit
 * alors sur 100 (120 avec la mention) et le staff donne l'Outstanding mention a une startup a 100,
 * comme pour un hackathon. Il ne compte pas dans l'Execution des fondateurs (services/scores.ts).
 */
export const PITCH_SCORING: EventScoring = scoringFrom(
  PITCH_CRITERIA.map((c) => ({ label: pitchCriterionShortLabel(c), mode: "criterion" as const, sourceKey: c.key, maxPoints: c.points })),
)!;

/** Ces cles (d'une grille de jury, ou notees dans des evaluations) sont la grille Pitch : ses dix criteres y sont (pas une grille Spring 2026). */
export const isPitchGrid = (keys: Iterable<string>): boolean => {
  const set = new Set(keys);
  return PITCH_KEYS.every((key) => set.has(key));
};

/** La grille de ce jury (ses criteres) est la grille Pitch. */
export const isPitchRubric = (criteria: readonly Pick<Criterion, "key">[]): boolean => isPitchGrid(criteria.map((c) => c.key));

/** La moyenne des jures sur chaque critere de la grille Pitch (shared/scoringRules.ts#juryMeansOf). */
export const pitchJuryMeans = (evaluations: readonly Pick<Evaluation, "scores">[]): Record<string, number> => juryMeansOf(evaluations, PITCH_KEYS);

/** Une seance de pitch d'une startup, calculee : la grille sur 100, chaque famille sur 100. */
export type PitchGrid = {
  /** La note de la grille, de 0 a 120 ; `null` sans aucune note. */
  total: number | null;
  /** La mention compte (posee par le staff ET grille a 100). */
  outstanding: boolean;
  /** Chaque famille sur 100 (120 avec la mention) ; `null` sans note dans la famille. */
  families: Record<PitchFamily, number | null>;
};

/**
 * LA note d'une startup a un pitch, depuis la moyenne des jures par critere (`pitchJuryMeans`) et la
 * mention du staff. Chaque note sur 100 : `pointsOn100` (« sans note, pas de poids »). La mention ne
 * compte qu'a 100 ; elle fait passer la grille ET chacune des trois familles (alors a 100) a 120.
 */
export function pitchGrid(means: Readonly<Record<string, number>>, mention: boolean): PitchGrid {
  const base = pointsOn100(PITCH_CRITERIA, means, PITCH_MAX_NOTE);
  const outstanding = mention && base !== null && reachesMax(base, PITCH_MAX);
  const bonus = (v: number | null) => (v === null ? null : withOutstanding(v, PITCH_MAX, outstanding));
  const families = Object.fromEntries(PITCH_FAMILIES.map((f) => [f, bonus(pointsOn100(PITCH_CRITERIA_BY_FAMILY[f], means, PITCH_MAX_NOTE))])) as Record<
    PitchFamily,
    number | null
  >;
  return { total: bonus(base), outstanding, families };
}

/**
 * Les anciennes cles de Spring 2026 (`teamQuality`, `speedOfExecution`, `marketPotential`), sur 5,
 * pour une evaluation (ou une moyenne de jures) de la grille Pitch : chaque famille ramenee a 5, sans
 * la mention. Une famille sans note est absente.
 */
export function legacyPitchScores(scores: Readonly<Record<string, number>>): Partial<Record<string, number>> {
  const { families } = pitchGrid(scores, false);
  return Object.fromEntries(
    PITCH_FAMILIES.flatMap((f) => {
      const v = families[f];
      return v === null ? [] : [[PITCH_FAMILY_INFO[f].legacyKey, roundTo((v / PITCH_MAX) * PITCH_MAX_NOTE, 2)]];
    }),
  );
}

// ---- Ce qu'une startup tire de ses pitchs (score startup) --------

/** Un pitch de la startup dans son score : le nom de l'evenement et sa grille. */
export type PitchInput = { name: string; grid: PitchGrid };

/**
 * Chaque famille d'une startup : la MOYENNE DE SES PITCHS (a poids egal), chaque
 * pitch etant deja la moyenne de ses jures critere par critere (`pitchJuryMeans`). Un pitch sans
 * note dans une famille n'y compte pas.
 */
export function pitchMeans(pitches: readonly PitchInput[]): Record<PitchFamily, number | null> {
  const of = (read: (g: PitchGrid) => number | null) => {
    const m = mean(pitches.flatMap((p) => read(p.grid) ?? []));
    return m === null ? null : roundTo(m, 2);
  };
  return {
    team: of((g) => g.families.team),
    speed: of((g) => g.families.speed),
    market: of((g) => g.families.market),
  };
}

// ---- Les questions d'apres la grille (affichees, jamais comptees) ------------------------------

/** Ce que les jures d'un pitch ont repondu apres la grille : Overall (0-5), Decision, Would you invest?, How likely. */
type PitchVerdicts = {
  overall: number | null;
  decisions: Partial<Record<EvaluationDecision, number>>;
  wouldInvest: { yes: number; answered: number };
  betLikelihood: number | null;
};

export function pitchVerdicts(evaluations: readonly Pick<Evaluation, "overallScore" | "decision" | "wouldInvest" | "betLikelihood">[]): PitchVerdicts {
  const numbers = (read: (e: (typeof evaluations)[number]) => number | null | undefined) => mean(evaluations.flatMap((e) => (typeof read(e) === "number" ? [read(e) as number] : [])));
  const decisions: Partial<Record<EvaluationDecision, number>> = {};
  for (const e of evaluations) if (e.decision) decisions[e.decision] = (decisions[e.decision] ?? 0) + 1;
  const answered = evaluations.filter((e) => typeof e.wouldInvest === "boolean");
  return {
    overall: numbers((e) => e.overallScore),
    decisions,
    wouldInvest: { yes: answered.filter((e) => e.wouldInvest).length, answered: answered.length },
    betLikelihood: numbers((e) => e.betLikelihood),
  };
}
