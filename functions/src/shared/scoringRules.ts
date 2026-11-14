import { roundTo, type Criterion, type EventMetric, type EventScoring, type Leaderboard, type ScoringItem, type ScoringItemInput } from "./types";

// ----------------------------
// Le bareme d'un hackathon (SPECS §4.2, decision du 13/11)
// ----------------------------
// Logique pure, lue par `services/leaderboards.ts`. Une equipe a des points par
// element du bareme : par unite d'une metrique, en proportion de la meilleure
// equipe, ou la moyenne des jures sur un critere. Une soumission en retard (sans
// exception du staff) vaut 0, comme un element mis a 0 apres la verification des
// preuves. Le score normalise (meilleure equipe = 100) s'additionne d'un
// hackathon a l'autre (classement cumule, sous-score Execution).

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
};

export type TeamPoints = { id: string; points: Record<string, number>; total: number; normalized: number };

/** Ramene a la meilleure equipe = 100 (0 si personne n'a de points). */
export const normalizeToBest = (value: number, top: number): number => (top > 0 ? roundTo((value / top) * 100, 2) : 0);

/**
 * Les classements qui comptent d'un hackathon a l'autre (classement cumule,
 * sous-score Execution) : ceux a bareme, publies. Une seule regle, lue par le
 * serveur (services/scores.ts) et l'interface (LeaderboardsContext).
 */
export const countsAcrossHackathons = (board: Pick<Leaderboard, "scoring" | "published">): boolean =>
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
  const topTotal = Math.max(0, ...withPoints.map((t) => t.total));
  return withPoints.map((t) => ({ ...t, normalized: normalizeToBest(t.total, topTotal) }));
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
