import {
  mean,
  roundTo,
  weightedMean,
  type Criterion,
  type Evaluation,
  type EventMetric,
  type EventScoring,
  type Leaderboard,
  type LeaderboardRow,
  type ScoringItem,
  type ScoringItemInput,
} from "./types";

// ----------------------------
// Le bareme d'un hackathon (SPECS §4.2, decision du 13/11)
// ----------------------------
// Logique pure, lue par `services/leaderboards.ts`. Une equipe a des points par
// element du bareme : la moyenne des jures sur un critere note de 0 a 5, ramenee
// a ses points (le modele du 17/11 : la grille du jury fait 100 points), ou, pour
// les anciens baremes, par unite d'une metrique ou en proportion de la meilleure
// equipe. Une soumission en retard (sans exception du staff) vaut 0, comme un
// element mis a 0 (ancienne verification des preuves).
//
// La note sur 100 (`normalized`) est ABSOLUE (decision du 17/11) : le total
// ramene au maximum de la grille, sans la ramener a la meilleure equipe. Une
// equipe au maximum peut recevoir l'Outstanding mention du staff : +20 % du
// maximum, soit 120. Seul un bareme sans maximum (points par unite) reste ramene
// a la meilleure equipe = 100. La note nourrit le sous-score Execution.

/** Ce que le bareme lit d'une equipe. */
export type ScoredTeam = {
  id: string;
  /** Les metriques de sa Submission. */
  metrics: Record<string, number>;
  /** La moyenne des jures par critere, sur l'echelle du critere. */
  juryMeans: Record<string, number>;
  /** En retard et sans exception : tout vaut 0. */
  late: boolean;
  zeroedItemKeys: readonly string[];
  /** L'Outstanding mention posee par le staff ; elle ne compte qu'au maximum de la grille. */
  outstanding: boolean;
};

export type TeamPoints = {
  id: string;
  points: Record<string, number>;
  total: number;
  normalized: number;
  /** La mention compte (posee par le staff ET equipe au maximum). */
  outstanding: boolean;
  /** L'equipe a le maximum de sa grille : le staff peut lui donner la mention. */
  outstandingEligible: boolean;
};

/** L'Outstanding mention : + 20 % du maximum de la grille, soit +20 sur une grille de 100 (100 -> 120). */
export const OUTSTANDING_BONUS_RATIO = 0.2;
export const OUTSTANDING_BONUS_POINTS = OUTSTANDING_BONUS_RATIO * 100;

/** Au maximum (a l'arrondi pres) seulement : la mention ne rattrape pas une note plus basse. */
export const reachesMax = (value: number, max: number): boolean => max > 0 && value >= max - 0.01;

/**
 * La valeur avec l'Outstanding mention : + 20 % du maximum, seulement au maximum (`reachesMax`).
 * LA regle de la mention : bareme d'un hackathon et grille Background (shared/background.ts).
 */
export const withOutstanding = (value: number, max: number, mention: boolean): number =>
  mention && reachesMax(value, max) ? roundTo(value + max * OUTSTANDING_BONUS_RATIO, 2) : value;

/**
 * Une grille a points sur 100 : chaque critere rapporte note ÷ `maxNote` × ses points. Un critere
 * non note est retire et les autres se partagent son poids (« sans note, pas de poids ») ; `null`
 * sans aucune note. LA formule des grilles Background (shared/background.ts) et Pitch (shared/pitchGrid.ts).
 */
export function pointsOn100(
  criteria: readonly { key: string; points: number }[],
  notes: Readonly<Partial<Record<string, number | null>>>,
  maxNote = 5,
): number | null {
  const m = weightedMean(
    criteria.map((c) => {
      const v = notes[c.key];
      return [typeof v === "number" && Number.isFinite(v) ? (Math.min(maxNote, Math.max(0, v)) / maxNote) * 100 : null, c.points] as const;
    }),
  );
  return m === null ? null : roundTo(m, 2);
}

/** La moyenne des jures, critere par critere (un critere que personne n'a note est absent). Leaderboard, grille Pitch. */
export function juryMeansOf(evaluations: readonly Pick<Evaluation, "scores">[], keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const m = mean(evaluations.flatMap((e) => (typeof e.scores?.[key] === "number" ? [e.scores[key]] : [])));
    if (m !== null) out[key] = m;
  }
  return out;
}

/** Ramene a la meilleure equipe = 100 (0 si personne n'a de points). */
export const normalizeToBest = (value: number, top: number): number => (top > 0 ? roundTo((value / top) * 100, 2) : 0);

/**
 * Les classements qui comptent dans le sous-score Execution : ceux a bareme,
 * publies (services/scores.ts). Plus de classement cumule depuis le 17/11.
 */
export const countsInExecution = (board: Pick<Leaderboard, "scoring" | "published">): boolean =>
  Boolean(board.scoring?.items.length) && board.published !== false;

/** Les points bruts d'un element, avant la proportion a la meilleure equipe. */
function rawPoints(item: ScoringItem, team: ScoredTeam, criteria: ReadonlyMap<string, Criterion>): number {
  if (item.mode === "criterion") {
    const mean = team.juryMeans[item.sourceKey];
    if (typeof mean !== "number") return 0;
    const scaleMax = criteria.get(item.sourceKey)?.max ?? null;
    return item.maxPoints && scaleMax ? (mean / scaleMax) * item.maxPoints : mean;
  }
  const value = team.metrics[item.sourceKey];
  if (typeof value !== "number") return 0;
  return item.mode === "per_unit" ? value * (item.pointsPerUnit ?? 1) : value;
}

/** Les points de chaque equipe, leur total et le score normalise. */
export function scoreTeams(scoring: EventScoring, criteria: readonly Criterion[], teams: readonly ScoredTeam[]): TeamPoints[] {
  const criteriaByKey = new Map(criteria.map((c) => [c.key, c]));
  const counts = (team: ScoredTeam, item: ScoringItem) => !team.late && !team.zeroedItemKeys.includes(item.key);
  const raw = teams.map((team) => ({
    team,
    raw: Object.fromEntries(scoring.items.map((item) => [item.key, counts(team, item) ? rawPoints(item, team, criteriaByKey) : 0])),
  }));
  // Proportionnel : la meilleure equipe a le maximum de l'element.
  const best = new Map(scoring.items.map((item) => [item.key, Math.max(0, ...raw.map((r) => r.raw[item.key]))]));
  const withPoints = raw.map(({ team, raw: values }) => {
    const points: Record<string, number> = {};
    for (const item of scoring.items) {
      const v = values[item.key];
      const top = best.get(item.key) ?? 0;
      points[item.key] = roundTo(item.mode === "proportional" ? (top > 0 ? (v / top) * (item.maxPoints ?? 0) : 0) : v, 2);
    }
    const total = roundTo(scoring.items.filter((i) => !i.tieBreakOnly).reduce((sum, i) => sum + points[i.key], 0), 2);
    return { id: team.id, points, total };
  });
  const max = scoringMaxTotal(scoring, criteria);
  // Ancien bareme sans maximum (points par unite) : la meilleure equipe = 100, sans mention.
  if (max === null) {
    const topTotal = Math.max(0, ...withPoints.map((t) => t.total));
    return withPoints.map((t) => ({ ...t, outstanding: false, outstandingEligible: false, normalized: normalizeToBest(t.total, topTotal) }));
  }
  return withPoints.map((t, i) => {
    const outstandingEligible = reachesMax(t.total, max);
    const outstanding = outstandingEligible && teams[i].outstanding;
    const total = withOutstanding(t.total, max, outstanding);
    return { ...t, total, outstanding, outstandingEligible, normalized: max > 0 ? roundTo((total / max) * 100, 2) : 0 };
  });
}

/** L'ordre du classement : le total, puis les departages du bareme dans l'ordre. `0` si rien ne les separe. */
export function compareTeamPoints(scoring: EventScoring, a: TeamPoints, b: TeamPoints): number {
  if (b.total !== a.total) return b.total - a.total;
  for (const key of scoring.tieBreaks) {
    const diff = (b.points[key] ?? 0) - (a.points[key] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ----------------------------
// L'affichage d'un classement a bareme (page Leaderboard du batch, Admin > Events)
// ----------------------------

/** Le libelle de chaque element, sa cle a defaut (element retire du bareme depuis). */
export const labelsOf = (scoring: Pick<EventScoring, "items">, keys: readonly string[]) => keys.map((k) => scoring.items.find((i) => i.key === k)?.label ?? k);

/** Ce qui compte, puis ce qui departage : « Points: Valid leads · Tie-break: Lead quality ». */
export function scoringSummary(scoring: EventScoring): string {
  const points = `Points: ${scoring.items.filter((i) => !i.tieBreakOnly).map((i) => i.label).join(", ")}`;
  return scoring.tieBreaks.length ? `${points} · Tie-break: ${labelsOf(scoring, scoring.tieBreaks).join(", ")}` : points;
}

/**
 * Le departage d'une ligne a egalite de total avec une autre : « Tie-break · Lead quality 4 »
 * (les points de chaque departage, dans l'ordre du bareme). `null` sans egalite ni departage.
 */
export function tieBreakNote(scoring: EventScoring, row: Pick<LeaderboardRow, "targetId" | "total" | "points">, rows: readonly Pick<LeaderboardRow, "targetId" | "total">[]): string | null {
  if (row.total === undefined || scoring.tieBreaks.length === 0) return null;
  if (!rows.some((r) => r.targetId !== row.targetId && r.total === row.total)) return null;
  const labels = labelsOf(scoring, scoring.tieBreaks);
  return `Tie-break · ${labels.map((label, i) => `${label} ${roundTo(row.points?.[scoring.tieBreaks[i]] ?? 0, 2)}`).join(", ")}`;
}

// ----------------------------
// Le reglage d'un bareme (Admin > Events > Leaderboard, `setEventScoring`)
// ----------------------------
// Un element = une variable des formulaires de l'evenement : une metrique de la
// Submission (`per_unit`, `proportional`) ou un critere du jury (`criterion`). La
// cle d'un element est celle de sa variable (une variable compte une fois).

/** Le maximum du total, `null` s'il est ouvert (un element par unite n'a pas de plafond). */
export function scoringMaxTotal(scoring: EventScoring, criteria: readonly Criterion[]): number | null {
  let total = 0;
  for (const item of scoring.items) {
    if (item.tieBreakOnly) continue;
    if (item.mode === "per_unit") return null;
    const max = item.maxPoints ?? (item.mode === "criterion" ? criteria.find((c) => c.key === item.sourceKey)?.max : null);
    if (!max) return null;
    total += max;
  }
  return total;
}

/** Les departages : les elements « tie-break only », dans l'ordre du bareme. */
export const tieBreaksOf = (items: readonly ScoringItem[]): string[] => items.filter((i) => i.tieBreakOnly).map((i) => i.key);

/** Un element regle par le staff, tel qu'il est stocke : cle = variable, points selon le mode. */
export const toScoringItem = (i: ScoringItemInput): ScoringItem => ({
  key: i.sourceKey,
  label: i.label,
  mode: i.mode,
  sourceKey: i.sourceKey,
  pointsPerUnit: i.mode === "per_unit" ? (i.pointsPerUnit ?? null) : null,
  maxPoints: i.mode === "per_unit" ? null : (i.maxPoints ?? null),
  ...(i.tieBreakOnly ? { tieBreakOnly: true } : {}),
});

/** Le bareme stocke pour ces elements, `null` sans element (le classement revient au jury ou a la metrique). */
export function scoringFrom(inputs: readonly ScoringItemInput[]): EventScoring | null {
  const items = inputs.map(toScoringItem);
  return items.length ? { items, tieBreaks: tieBreaksOf(items) } : null;
}

/** La variable de l'element est-elle une question des formulaires de l'evenement ? */
export const variableExists = (item: Pick<ScoringItem, "mode" | "sourceKey">, metrics: readonly EventMetric[], criteria: readonly Criterion[]) =>
  (item.mode === "criterion" ? criteria : metrics).some((v) => v.key === item.sourceKey);

/** Ce qui empeche d'enregistrer ce bareme, en clair (vide : valide). */
export function scoringProblems(scoring: EventScoring, metrics: readonly EventMetric[], criteria: readonly Criterion[]): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const item of scoring.items) {
    const name = item.label || item.sourceKey;
    if (keys.has(item.key)) problems.push(`${name}: this variable is already in the scoring.`);
    keys.add(item.key);
    if (!variableExists(item, metrics, criteria)) problems.push(`${name}: no question of the event's ${item.mode === "criterion" ? "jury form" : "submission"} writes \`${item.sourceKey}\`.`);
    if (item.mode === "per_unit" && !(Number(item.pointsPerUnit) > 0)) problems.push(`${name}: points per unit must be above 0.`);
    if (item.mode === "proportional" && !(Number(item.maxPoints) > 0)) problems.push(`${name}: the best team's points must be above 0.`);
    if (item.mode === "criterion" && item.maxPoints != null && !(item.maxPoints > 0)) problems.push(`${name}: the points must be above 0.`);
  }
  if (scoring.items.length > 0 && scoring.items.every((i) => i.tieBreakOnly)) problems.push("At least one item must count in the total.");
  return problems;
}
