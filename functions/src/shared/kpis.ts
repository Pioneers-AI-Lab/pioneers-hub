import { COL, docPaths } from "./collections";
import { DB_FIELDS, parseDbField } from "./fieldRegistry";
import type { Checkin, KpiPoint, KpiSeries, MetricKey, MetricSnapshot, Startup, StartupScoped } from "./types";

// ----------------------------
// Updates du jeudi -> metricSnapshots + kpiSeries (logique pure)
// ----------------------------
// Un update par fondateur et par semaine (`checkins`, un nouvel envoi remplace
// le precedent) ; plusieurs membres d'une startup peuvent chacun remplir le
// leur : par indicateur et par semaine, la valeur de la startup est le MAXIMUM
// declare pour un compteur (SPECS §12 q7, §5.3), la MOYENNE pour une note
// (le moral est personnel). Provisoire : a terme, une seule saisie par startup.
//   - `metricSnapshots/{startupId}_{metric}_{lundi}` : un releve par startup,
//     indicateur et semaine, `sourcePath` = l'update retenu (le maximum, ou le
//     premier des updates moyennes).
//   - `kpiSeries/{startupId}` : les memes valeurs en courbes, triees par semaine.
// Le declencheur `onCheckinWritten` (functions/src/index.ts) et
// scripts/backfill-kpis.mjs ne font que lire, appeler `planStartupKpis`, ecrire.

/**
 * Champ numerique de `Checkin` marque `indicator` dans le registre. Entre
 * cofondateurs : le maximum d'un compteur, la moyenne d'une note (`rating`).
 */
type CheckinIndicator = { field: keyof Checkin & string; metric: MetricKey; combine: "max" | "mean" };

/** Les indicateurs de l'update, tires du registre : un nouvel indicateur `checkin.*` y entre seul. */
export const CHECKIN_INDICATORS: readonly CheckinIndicator[] = (Object.keys(DB_FIELDS) as (keyof typeof DB_FIELDS)[]).flatMap((key) => {
  const { doc, field } = parseDbField(key);
  const { indicator: metric, value } = DB_FIELDS[key];
  return doc === "checkin" && metric ? [{ field: field as keyof Checkin & string, metric, combine: value.kind === "rating" ? "mean" : "max" }] : [];
});

export type CheckinDoc = { path: string; data: Partial<Checkin> };
export type SnapshotDoc = { path: string; data: MetricSnapshot };

/** Valeur retenue d'un indicateur pour une semaine, entre fondateurs (`combine`). */
export type WeeklyValue = { metric: MetricKey; weekStartDayString: string; value: number; sourcePath: string };

const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Memes ids, dans n'importe quel ordre. */
export const sameIds = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((id) => (b ?? []).includes(id));

/** Les indicateurs d'un update ont-ils change (semaine comprise) ? Sinon, rien a recalculer. */
export function checkinIndicatorsChanged(before: Partial<Checkin> | undefined, after: Partial<Checkin> | undefined): boolean {
  if (!before || !after) return before !== after;
  if (before.startupId !== after.startupId || before.weekStartDayString !== after.weekStartDayString) return true;
  return CHECKIN_INDICATORS.some(({ field }) => asNumber(before[field]) !== asNumber(after[field]));
}

/** L'equipe ou le batch d'une startup ont-ils change ? Les copies `memberIds` / `founderIds` des agregats suivent. */
export const startupScopeChanged = (before: Partial<Startup>, after: Partial<Startup>) =>
  before.batchId !== after.batchId || before.programId !== after.programId || !sameIds(before.memberIds, after.memberIds);

/** Parents et membres des agregats : ceux de la startup, sinon ceux recopies dans un de ses updates. */
export function startupKpiScope(startupId: string, startup: Partial<Startup> | undefined, checkins: readonly CheckinDoc[]): StartupScoped | null {
  const source = startup ?? checkins[0]?.data;
  if (!source?.programId || !source.batchId) return null;
  return { programId: source.programId, batchId: source.batchId, startupId, memberIds: source.memberIds ?? [] };
}

/**
 * Par indicateur et par semaine, la valeur de la startup : le maximum declare
 * (compteur) ou la moyenne a un chiffre apres la virgule (note). Une valeur
 * absente, nulle ou non numerique est ignoree. `sourcePath` : l'update du
 * maximum, a egalite (ou pour une moyenne) celui au chemin le plus petit
 * (resultat stable d'un calcul a l'autre). Trie par semaine.
 */
export function weeklyValues(checkins: readonly CheckinDoc[]): WeeklyValue[] {
  type Group = { indicator: CheckinIndicator; week: string; sum: number; count: number; max: number; maxPath: string; firstPath: string };
  const groups = new Map<string, Group>();
  for (const { path, data } of checkins) {
    const week = data.weekStartDayString;
    if (!week) continue;
    for (const indicator of CHECKIN_INDICATORS) {
      const value = asNumber(data[indicator.field]);
      if (value === null) continue;
      const key = `${indicator.metric}|${week}`;
      const g = groups.get(key);
      if (!g) {
        groups.set(key, { indicator, week, sum: value, count: 1, max: value, maxPath: path, firstPath: path });
        continue;
      }
      g.sum += value;
      g.count += 1;
      if (value > g.max || (value === g.max && path < g.maxPath)) Object.assign(g, { max: value, maxPath: path });
      if (path < g.firstPath) g.firstPath = path;
    }
  }
  return [...groups.values()]
    .map(({ indicator, week, sum, count, max, maxPath, firstPath }): WeeklyValue =>
      indicator.combine === "mean"
        ? { metric: indicator.metric, weekStartDayString: week, value: Math.round((sum / count) * 10) / 10, sourcePath: firstPath }
        : { metric: indicator.metric, weekStartDayString: week, value: max, sourcePath: maxPath },
    )
    .sort((a, b) => a.weekStartDayString.localeCompare(b.weekStartDayString));
}

/** Les courbes de `kpiSeries` : un point par semaine renseignee (`values` est deja trie par semaine). */
export function kpiSeriesFrom(values: readonly WeeklyValue[]): KpiSeries["series"] {
  const series: Partial<Record<MetricKey, KpiPoint[]>> = {};
  for (const m of values) (series[m.metric] ??= []).push({ weekStartDayString: m.weekStartDayString, value: m.value });
  return series;
}

/** Memes courbes (l'ordre des cles d'une map n'est pas garde par Firestore). */
function sameSeries(a: KpiSeries["series"], b: KpiSeries["series"]): boolean {
  const keys = Object.keys(a) as MetricKey[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => {
    const pa = a[k]!;
    const pb = b[k];
    return !!pb && pa.length === pb.length && pa.every((p, i) => p.weekStartDayString === pb[i].weekStartDayString && p.value === pb[i].value);
  });
}

/** Releve ecrit par un update (et non par le staff, un import ou un hackathon au meme id). */
export const isCheckinSnapshot = (s: Pick<MetricSnapshot, "sourcePath">) => !!s.sourcePath?.startsWith(`${COL.checkins}/`);

/** Chemins de tous les releves qu'un update de la semaine peut produire (pour les relire avant d'ecrire). */
export const checkinSnapshotPaths = (startupId: string, weeks: Iterable<string>) =>
  [...new Set(weeks)].flatMap((week) => CHECKIN_INDICATORS.map((i) => docPaths.metricSnapshot(startupId, i.metric, week, null)));

export type StartupKpisPlan = {
  /** `null` : courbes deja a jour, rien a ecrire. */
  kpiSeries: KpiSeries | null;
  sets: SnapshotDoc[];
  deletes: string[];
};

/**
 * Ce qu'il faut ecrire pour une startup. Rien n'est reecrit s'il est inchange.
 * - `checkins` : TOUS les updates de la startup (la courbe est recalculee en entier).
 * - `existing` : les releves deja en base aux chemins concernes (`checkinSnapshotPaths`),
 *   ou tous ceux de la startup ; un releve d'une autre source n'est jamais touche.
 * - `weeks` : les semaines a reconcilier (declencheur : celles de l'update modifie) ;
 *   `null` = toutes (rattrapage, changement d'equipe), `existing` doit alors tout contenir.
 * - `previousSeries` : le `kpiSeries` en base, s'il existe.
 */
export function planStartupKpis(input: {
  scope: StartupScoped;
  checkins: readonly CheckinDoc[];
  existing: readonly SnapshotDoc[];
  weeks: readonly string[] | null;
  previousSeries: KpiSeries | undefined;
  nowISOString: string;
}): StartupKpisPlan {
  const { scope, checkins, existing, previousSeries, nowISOString } = input;
  const weekly = weeklyValues(checkins);
  const owned = existing.filter((s) => isCheckinSnapshot(s.data));
  const weeks = new Set(input.weeks ?? [...weekly.map((m) => m.weekStartDayString), ...owned.map((s) => s.data.dayString)]);
  const byPath = new Map(existing.map((s) => [s.path, s.data]));

  const sets: SnapshotDoc[] = [];
  const wanted = new Set<string>();
  for (const m of weekly) {
    if (!weeks.has(m.weekStartDayString)) continue;
    const path = docPaths.metricSnapshot(scope.startupId, m.metric, m.weekStartDayString, null);
    wanted.add(path);
    const previous = byPath.get(path);
    if (previous && !isCheckinSnapshot(previous)) continue;
    if (
      previous &&
      previous.value === m.value &&
      previous.sourcePath === m.sourcePath &&
      previous.batchId === scope.batchId &&
      sameIds(previous.founderIds, scope.memberIds)
    ) {
      continue;
    }
    sets.push({
      path,
      data: {
        programId: scope.programId,
        batchId: scope.batchId,
        subjectType: "startup",
        subjectId: scope.startupId,
        founderIds: [...scope.memberIds],
        eventId: null,
        metric: m.metric,
        value: m.value,
        dayString: m.weekStartDayString,
        phase: null,
        source: "self_reported",
        proofUrl: null,
        sourcePath: m.sourcePath,
        recordedByUid: null,
        recordedDateISOString: nowISOString,
      },
    });
  }
  const deletes = owned.filter((s) => weeks.has(s.data.dayString) && !wanted.has(s.path)).map((s) => s.path);

  const series = kpiSeriesFrom(weekly);
  const seriesUnchanged =
    !!previousSeries &&
    previousSeries.programId === scope.programId &&
    previousSeries.batchId === scope.batchId &&
    sameIds(previousSeries.memberIds, scope.memberIds) &&
    sameSeries(previousSeries.series ?? {}, series);
  return {
    kpiSeries: seriesUnchanged
      ? null
      : {
          programId: scope.programId,
          batchId: scope.batchId,
          startupId: scope.startupId,
          memberIds: [...scope.memberIds],
          series,
          computedDateISOString: nowISOString,
        },
    sets,
    deletes,
  };
}
