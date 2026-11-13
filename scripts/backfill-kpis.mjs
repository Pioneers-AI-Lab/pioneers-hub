// ----------------------------
// Rattrapage des series d'un batch : checkins -> metricSnapshots + kpiSeries
// ----------------------------
// node scripts/backfill-kpis.mjs fall-2026            a blanc, projet reel (lecture seule)
// node scripts/backfill-kpis.mjs fall-2026 --prod     ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/backfill-kpis.mjs fall-2026 [--prod]   emulateurs
//
// Meme calcul que le declencheur `onCheckinWritten` (shared/kpis.ts#planStartupKpis) :
// par indicateur et par semaine, le maximum entre les updates des fondateurs.
// Sert pour les updates ecrits avant le deploiement du declencheur. Rejouable :
// un releve inchange n'est pas reecrit, un releve d'une autre source n'est jamais touche.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { planStartupKpis, startupKpiScope } = require("../functions/lib/shared/kpis.js");
const { COL, docPaths } = require("../functions/lib/shared/collections.js");

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
if (!batchId) {
  console.error("usage: node scripts/backfill-kpis.mjs <batchId> [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
const now = new Date().toISOString();

const [startups, checkins, snapshots, series] = await Promise.all(
  [COL.startups, COL.checkins, COL.metricSnapshots, COL.kpiSeries].map((c) => db.collection(c).where("batchId", "==", batchId).get()),
);
const group = (docs, key) => {
  const m = new Map();
  for (const d of docs) {
    const k = d.get(key);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ path: d.ref.path, data: d.data() });
  }
  return m;
};
const checkinsBy = group(checkins.docs, "startupId");
const snapshotsBy = group(snapshots.docs, "subjectId");
const seriesBy = new Map(series.docs.map((d) => [d.id, d.data()]));
const startupsById = new Map(startups.docs.map((d) => [d.id, d.data()]));

console.log(`${PROJECT_ID} · ${batchId} : ${startups.size} startups, ${checkins.size} updates, ${snapshots.size} releves, ${series.size} kpiSeries\n`);

const count = (s) => Object.values(s ?? {}).reduce((n, points) => n + points.length, 0);

const ops = [];
for (const startupId of new Set([...startupsById.keys(), ...checkinsBy.keys()])) {
  const startup = startupsById.get(startupId);
  const own = checkinsBy.get(startupId) ?? [];
  const previousSeries = seriesBy.get(startupId);
  const scope = startupId ? startupKpiScope(startupId, startup, own) : null;
  if (!scope || (own.length === 0 && !previousSeries)) continue;
  const plan = planStartupKpis({
    scope,
    checkins: own,
    existing: snapshotsBy.get(startupId) ?? [],
    weeks: null,
    previousSeries,
    nowISOString: now,
  });
  console.log(
    `${(startup?.name ?? startupId).slice(0, 30).padEnd(30)} ${String(own.length).padStart(3)} updates  ` +
      `points ${count(previousSeries?.series)} -> ${count((plan.kpiSeries ?? previousSeries).series)}  ` +
      `releves +${plan.sets.length} -${plan.deletes.length}`,
  );
  if (plan.kpiSeries) ops.push({ kind: "set", path: docPaths.kpiSeries(startupId), data: plan.kpiSeries });
  for (const s of plan.sets) ops.push({ kind: "set", path: s.path, data: s.data });
  for (const p of plan.deletes) ops.push({ kind: "delete", path: p });
}

if (!write) {
  console.log(`\nA blanc : ${ops.length} ecriture(s). Ajouter --prod pour ecrire (${PROJECT_ID}).`);
  process.exit(0);
}
for (let i = 0; i < ops.length; i += 400) {
  const batch = db.batch();
  for (const op of ops.slice(i, i + 400)) {
    if (op.kind === "set") batch.set(db.doc(op.path), op.data);
    else batch.delete(db.doc(op.path));
  }
  await batch.commit();
}
console.log(`\n${ops.length} ecriture(s) faite(s) sur ${PROJECT_ID}.`);
