import { weightedMean, type BatchScoped, type DateISOString, type TargetKind } from "./common";

// ----------------------------
// scores/{targetType}_{targetId}  (staff + investors des deux niveaux, ecrit par Cloud Functions)
// ----------------------------
// SPECS §5 : les SOUS-SCORES sont stockes, les PONDERATIONS s'appliquent a
// l'affichage. Ce document existe parce que les donnees d'entree des scores
// vivent dans des documents sensibles (`private/internal`, `founderStats`) que
// les investors portfolio ne lisent pas : la fonction les lit avec le SDK
// admin et n'expose ici que le resultat et des signaux non sensibles.
// Echelle (`scale`) : sur 100 pour un score calcule par le Hub depuis le 17/11
// (docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §3) ; sur 10 pour les scores importes
// de Spring 2026 et ceux d'avant (champ absent). Un sous-score sans donnee vaut
// `null` : il est retire, et les autres se partagent son poids. Sur 100, un
// sous-score peut depasser 100 (Outstanding mention : pas de plafond).

/** Les cinq sous-scores de la Program Performance (sur 100) : Background remplace Achievements et l'Elo. */
export const FOUNDER_PILLARS = ["engagement", "execution", "likability", "commitment", "background"] as const;
export type FounderPillar = (typeof FOUNDER_PILLARS)[number];

/** Les piliers d'un score sur 10 (Spring 2026, importe ; fa26 avant le 17/11). */
export const LEGACY_FOUNDER_PILLARS = ["engagement", "execution", "likability", "commitment", "achievements"] as const;
export type LegacyFounderPillar = (typeof LEGACY_FOUNDER_PILLARS)[number];
export type FounderPillarKey = FounderPillar | LegacyFounderPillar;

export const STARTUP_SUBSCORES = ["market", "team", "execution", "traction"] as const;
export type StartupSubScore = (typeof STARTUP_SUBSCORES)[number];

/** L'echelle d'un score : 100 (Hub, depuis le 17/11) ou 10 (importe, ou d'avant). */
export type ScoreScale = 10 | 100;
/** Les scores que le Hub ecrit. */
export const HUB_SCORE_SCALE: ScoreScale = 100;
/** L'echelle d'un document de score : absente = 10 (documents d'avant le 17/11, Spring 2026). */
export const scoreScaleOf = (score: { scale?: ScoreScale } | null | undefined): ScoreScale => score?.scale ?? 10;

/** Un signal qui explique un sous-score (« Hackathons (3) » : 74). */
export type ScoreSignal = {
  label: string;
  /** Valeur brute affichable (`"84%"`, `"3/8 tables"`). */
  raw: string;
  /** Sur l'echelle du score (`scale` : 100, ou 10 pour un score d'avant). */
  score: number;
  /** Poids relatif dans son sous-score (pourcentages sur 100 : 50, 30, 20 ; 1 = poids egaux). */
  weight: number;
};

export type FounderScore = BatchScoped & {
  targetType: "founder";
  targetId: string;
  /** Les cinq sous-scores de son echelle : `FOUNDER_PILLARS` sur 100, `LEGACY_FOUNDER_PILLARS` sur 10. */
  subScores: Partial<Record<FounderPillarKey, number | null>>;
  /** Absent : 10 (avant le 17/11, Spring 2026). */
  scale?: ScoreScale;
  /** Part des piliers disponibles (0-1). */
  dataCompleteness: number;
  computedDateISOString: DateISOString;
};

export type StartupScore = BatchScoped & {
  targetType: "startup";
  targetId: string;
  subScores: Record<StartupSubScore, number | null>;
  /** Absent : 10 (avant le 17/11, Spring 2026). */
  scale?: ScoreScale;
  dataCompleteness: number;
  computedDateISOString: DateISOString;
};

export type Score = FounderScore | StartupScore;

// ----------------------------
// scoreSignals/{targetType}_{targetId}  (staff + investors IC, ecrit par Cloud Functions)
// ----------------------------
// Le detail des sous-scores est SEPARE des valeurs : il contient des
// appreciations du staff (grille Background, « Clear idea ») que les investors
// portfolio ne doivent pas voir. Meme echelle que le score du meme id.

export type ScoreSignals = BatchScoped & {
  targetType: TargetKind;
  targetId: string;
  signals: Partial<Record<FounderPillarKey | StartupSubScore, ScoreSignal[]>>;
  computedDateISOString: DateISOString;
};

// ---- Ponderations (appliquees a l'affichage) ---------------------------------

/** Une composante de ponderation : la moyenne de ses sous-scores presents, avec son poids. */
export type WeightingComponent = {
  label: string;
  weight: number;
  parts: StartupSubScore[];
};

/**
 * Ponderation du score startup sur 100 (docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §3.1) :
 * Team 40 %, Execution 20 %, Traction 20 %, Market 20 %, A PLAT : un sous-score sans
 * donnee est retire et les autres gardent leurs proportions. Execution et Traction
 * forment ensemble le Speed of execution (40 %) de la grille Pitch.
 */
export const STARTUP_WEIGHTING_100: WeightingComponent[] = [
  { label: "Team", weight: 40, parts: ["team"] },
  { label: "Execution", weight: 20, parts: ["execution"] },
  { label: "Traction", weight: 20, parts: ["traction"] },
  { label: "Market", weight: 20, parts: ["market"] },
];

/**
 * Ponderation d'un score sur 10 (Spring 2026, et fa26 avant le 17/11) : Team 40 %,
 * Speed of execution 40 % (= moyenne d'Execution et de Traction), Market 20 %.
 * IMBRIQUEE : si Traction manque, Speed of execution vaut Execution et garde ses 40 %.
 */
export const STARTUP_WEIGHTING: WeightingComponent[] = [
  { label: "Team", weight: 40, parts: ["team"] },
  { label: "Speed of execution", weight: 40, parts: ["execution", "traction"] },
  { label: "Market", weight: 20, parts: ["market"] },
];

/** Ce qui change avec l'echelle d'un score : piliers du fondateur, ponderation startup, regle affichee. */
export type ScaleRules = {
  pillars: readonly FounderPillarKey[];
  startupWeighting: WeightingComponent[];
  /** La regle de la Program Performance en clair. */
  performanceHint: string;
};

/** LA table des echelles : le seul endroit ou 10 et 100 different. */
export const SCALE_RULES: Record<ScoreScale, ScaleRules> = {
  100: {
    pillars: FOUNDER_PILLARS,
    startupWeighting: STARTUP_WEIGHTING_100,
    performanceHint: "Average of the five sub-scores, 20% each. Above 100 with an Outstanding mention.",
  },
  10: { pillars: LEGACY_FOUNDER_PILLARS, startupWeighting: STARTUP_WEIGHTING, performanceHint: "Average of the five pillars." },
};

/** Les regles de l'echelle d'un score (absente = 10). */
export const scaleRulesOf = (score: { scale?: ScoreScale } | null | undefined): ScaleRules => SCALE_RULES[scoreScaleOf(score)];

/** La grille en clair, pour l'interface : « Team 40, Execution 20, Traction 20, Market 20 ». */
export const startupWeightingHint = (score: { scale?: ScoreScale } | null | undefined) =>
  scaleRulesOf(score)
    .startupWeighting.map((c) => `${c.label} ${c.weight}`)
    .join(", ");

/** Program Performance : moyenne des piliers presents de son echelle, a poids egal (20 % chacun) ; `null` si aucun. */
export const programPerformance = (score: Pick<FounderScore, "subScores" | "scale">): number | null =>
  weightedMean(scaleRulesOf(score).pillars.map((pillar) => [score.subScores[pillar] ?? null, 1] as const));

/**
 * Score startup, selon son echelle. Une composante vaut la moyenne de ses
 * sous-scores presents ; une composante sans donnee est retiree et les autres
 * se partagent son poids. `null` si aucune donnee.
 */
export const startupScore = (score: Pick<StartupScore, "subScores" | "scale">): number | null =>
  weightedMean(
    scaleRulesOf(score).startupWeighting.map(
      (component) => [weightedMean(component.parts.map((part) => [score.subScores[part], 1] as const)), component.weight] as const,
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
