import { getFirestore } from "firebase-admin/firestore";
import { COL, docPaths } from "../shared/collections";
import {
  checkinIndicatorsChanged,
  checkinSnapshotPaths,
  planStartupKpis,
  startupKpiScope,
  startupScopeChanged,
} from "../shared/kpis";
import type { Checkin, KpiSeries, MetricSnapshot, Startup } from "../shared/types";

// ----------------------------
// Series des indicateurs (declencheurs Firestore, functions/src/index.ts)
// ----------------------------
// Tout ecrivain d'un update du jeudi (formulaire, /v1, MCP, interface, import)
// passe par `checkins` : le declencheur couvre tout le monde. La regle (maximum
// entre fondateurs, releves a id deterministe) est dans shared/kpis.ts.

/**
 * Recalcule `kpiSeries/{startupId}` et reconcilie ses releves (`metricSnapshots`)
 * pour les semaines donnees (`null` = toutes), dans une transaction : deux
 * updates simultanes d'une meme startup ne s'ecrasent pas.
 */
export async function recomputeStartupKpis(startupId: string, weeks: readonly string[] | null): Promise<void> {
  const db = getFirestore();
  const seriesRef = db.doc(docPaths.kpiSeries(startupId));
  await db.runTransaction(async (tx) => {
    const [startupSnap, checkinsSnap, seriesSnap, existingSnaps] = await Promise.all([
      tx.get(db.doc(docPaths.startup(startupId))),
      tx.get(db.collection(COL.checkins).where("startupId", "==", startupId)),
      tx.get(seriesRef),
      // Toutes les semaines : tous les releves de la startup ; sinon ceux des semaines touchees.
      weeks
        ? weeks.length > 0
          ? tx.getAll(...checkinSnapshotPaths(startupId, weeks).map((p) => db.doc(p)))
          : []
        : tx.get(db.collection(COL.metricSnapshots).where("subjectId", "==", startupId)).then((q) => q.docs),
    ]);
    const checkins = checkinsSnap.docs.map((d) => ({ path: d.ref.path, data: d.data() as Partial<Checkin> }));
    const scope = startupKpiScope(startupId, startupSnap.data() as Startup | undefined, checkins);
    if (!scope) return;

    const plan = planStartupKpis({
      scope,
      checkins,
      existing: existingSnaps.filter((s) => s.exists).map((s) => ({ path: s.ref.path, data: s.data() as MetricSnapshot })),
      weeks,
      previousSeries: seriesSnap.data() as KpiSeries | undefined,
      nowISOString: new Date().toISOString(),
    });
    if (plan.kpiSeries) tx.set(seriesRef, plan.kpiSeries);
    for (const s of plan.sets) tx.set(db.doc(s.path), s.data);
    for (const p of plan.deletes) tx.delete(db.doc(p));
  });
}

/** `checkins/{id}` cree, modifie ou supprime : les semaines touchees de la (ou des) startup(s). */
export async function onCheckinWritten(before: Partial<Checkin> | undefined, after: Partial<Checkin> | undefined) {
  if (!checkinIndicatorsChanged(before, after)) return;
  const weeksByStartup = new Map<string, Set<string>>();
  for (const c of [before, after]) {
    if (!c?.startupId || !c.weekStartDayString) continue;
    const weeks = weeksByStartup.get(c.startupId) ?? new Set<string>();
    weeksByStartup.set(c.startupId, weeks.add(c.weekStartDayString));
  }
  await Promise.all([...weeksByStartup].map(([startupId, weeks]) => recomputeStartupKpis(startupId, [...weeks])));
}

/** L'equipe ou le batch d'une startup change : la copie `memberIds` / `founderIds` des agregats suit. */
export async function onStartupUpdated(startupId: string, before: Partial<Startup> | undefined, after: Partial<Startup> | undefined) {
  if (before && after && startupScopeChanged(before, after)) await recomputeStartupKpis(startupId, null);
}
