import { weightedMean, type BatchScoped, type DateISOString, type TargetKind } from "./common";

// ----------------------------
// scores/{targetType}_{targetId}  (staff + investors des deux niveaux, ecrit par Cloud Functions)
// ----------------------------
// SPECS §5 : les SOUS-SCORES sont stockes, les PONDERATIONS s'appliquent a
// l'affichage. Ce document existe parce que les donnees d'entree des scores
// vivent dans des documents sensibles (`private/internal`, `founderStats`) que
// les investors portfolio ne lisent pas : la fonction les lit avec le SDK
// admin et n'expose ici que le resultat et des signaux non sensibles.
// Tout est sur 10. Un pilier ou sous-score sans donnee vaut `null` : il est
// retire, et les autres se partagent son poids.

export const FOUNDER_PILLARS = ["engagement", "execution", "likability", "commitment", "achievements"] as const;
export type FounderPillar = (typeof FOUNDER_PILLARS)[number];

export const STARTUP_SUBSCORES = ["market", "team", "execution", "traction"] as const;
export type StartupSubScore = (typeof STARTUP_SUBSCORES)[number];

/**
 * Score de base d'un fondateur, calcule a l'onboarding (brief du 11/11) avec
 * la grille de scoring des fondateurs de Pioneers. On teste ensuite s'il
 * predit ce qui se passe pendant le batch. Detail de la grille : a obtenir
 * (SPECS §12).
 */
export const BASELINE_CRITERIA = ["execution", "founderSignal", "pedigree", "geography"] as const;
export type BaselineCriterion = (typeof BASELINE_CRITERIA)[number];

export const BASELINE_WEIGHTS: Record<BaselineCriterion, number> = {
  execution: 40,
  founderSignal: 25,
  pedigree: 20,
  geography: 15,
};
/** Un signal qui explique un sous-score (detail au survol, comme le dashboard SP26). */
export type ScoreSignal = {
  label: string;
  /** Valeur brute affichable (`"84%"`, `"3/8 tables"`). */
  raw: string;
  /** Sur 10. */
  score: number;
  /** Poids relatif dans son pilier (1 par defaut, 0,5 ou 0,25 pour certains signaux). */
  weight: number;
};

export type FounderScore = BatchScoped & {
  targetType: "founder";
  targetId: string;
  subScores: Record<FounderPillar, number | null>;
  /** Score de base a l'onboarding, fige ensuite (on ne le recalcule pas avec les donnees du batch). */
  baseline: Record<BaselineCriterion, number | null>;
  baselineComputedDateISOString: DateISOString | null;
  /** Part des piliers disponibles (0-1). */
  dataCompleteness: number;
  computedDateISOString: DateISOString;
};

export type StartupScore = BatchScoped & {
  targetType: "startup";
  targetId: string;
  subScores: Record<StartupSubScore, number | null>;
  dataCompleteness: number;
  computedDateISOString: DateISOString;
};

export type Score = FounderScore | StartupScore;

// ----------------------------
// scoreSignals/{targetType}_{targetId}  (staff + investors IC, ecrit par Cloud Functions)
// ----------------------------
// Le detail des sous-scores est SEPARE des valeurs : il contient des
// appreciations du staff (« High potential : Yes », « Clear idea », statut
// d'engagement) que les investors portfolio ne doivent pas voir.

export type ScoreSignals = BatchScoped & {
  targetType: TargetKind;
  targetId: string;
  signals: Partial<Record<FounderPillar | StartupSubScore, ScoreSignal[]>>;
  computedDateISOString: DateISOString;
};

// ---- Ponderations (appliquees a l'affichage) ---------------------------------

/** Program Performance : les cinq piliers a poids egal. */
export const PROGRAM_PERFORMANCE_WEIGHTS: Record<FounderPillar, number> = {
  engagement: 1,
  execution: 1,
  likability: 1,
  commitment: 1,
  achievements: 1,
};

export type StartupWeightingKey = "dashboard" | "ic";

/** Une composante de ponderation : la moyenne de ses sous-scores presents, avec son poids. */
export type WeightingComponent = {
  label: string;
  weight: number;
  parts: StartupSubScore[];
};

/**
 * Les deux ponderations du score startup, cote a cote (decision du 11/11).
 * IC : Team 40 %, Speed of execution 40 % (= moyenne d'Execution et de
 * Traction, a confirmer : SPECS §12 question 3), Market 20 %.
 * Gardee IMBRIQUEE, pas a plat (20 / 20) : si Traction manque, Speed of
 * execution vaut Execution et garde ses 40 %.
 */
export const STARTUP_WEIGHTINGS: Record<StartupWeightingKey, WeightingComponent[]> = {
  dashboard: [
    { label: "Market", weight: 25, parts: ["market"] },
    { label: "Team", weight: 25, parts: ["team"] },
    { label: "Execution", weight: 25, parts: ["execution"] },
    { label: "Traction", weight: 25, parts: ["traction"] },
  ],
  ic: [
    { label: "Team", weight: 40, parts: ["team"] },
    { label: "Speed of execution", weight: 40, parts: ["execution", "traction"] },
    { label: "Market", weight: 20, parts: ["market"] },
  ],
};

/** Program Performance : moyenne des piliers presents ; `null` si aucun. */
export const programPerformance = (subScores: Record<FounderPillar, number | null>): number | null =>
  weightedMean(FOUNDER_PILLARS.map((pillar) => [subScores[pillar], PROGRAM_PERFORMANCE_WEIGHTS[pillar]] as const));

/** Score de base : moyenne ponderee des criteres presents ; `null` si aucun. */
export const baselineScore = (baseline: Record<BaselineCriterion, number | null>): number | null =>
  weightedMean(BASELINE_CRITERIA.map((criterion) => [baseline[criterion], BASELINE_WEIGHTS[criterion]] as const));

/**
 * Score startup pour une ponderation. Une composante vaut la moyenne de ses
 * sous-scores presents ; une composante sans donnee est retiree et les autres
 * se partagent son poids. `null` si aucune donnee.
 */
export const startupScore = (
  subScores: Record<StartupSubScore, number | null>,
  weighting: StartupWeightingKey,
): number | null =>
  weightedMean(
    STARTUP_WEIGHTINGS[weighting].map(
      (component) => [weightedMean(component.parts.map((part) => [subScores[part], 1] as const)), component.weight] as const,
    ),
  );

// ----------------------------
// eloMatches/{matchId}  (staff + investors IC)
// ----------------------------
// Un classement par le modele d'un groupe de 5 profils (SPECS §5.1). Le
// raisonnement est CONSERVE (il alimente la fiche) ; noms et emails ne sont
// pas envoyes au modele.

export type EloMatch = BatchScoped & {
  /** Du premier au dernier. */
  rankedFounderIds: string[];
  reasoning: string | null;
  /** Variation d'Elo de chaque fondateur sur ce classement. */
  eloDeltas: Record<string, number>;
  model: string;
  promptVersion: string;
  dateISOString: DateISOString;
};
