// ----------------------------
// Migration vers les cles de metriques standard (SPECS annexe A.5, decision du 13/11)
// ----------------------------
// node scripts/migrate-metric-keys.mjs spring-2026            a blanc, projet reel (lecture seule)
// node scripts/migrate-metric-keys.mjs spring-2026 --prod     ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/migrate-metric-keys.mjs spring-2026 [--prod]   emulateurs
//
// Renomme, pour un batch, les anciennes cles (shared/presets/standardMetrics.ts) :
//   - metriques d'evenement (`EVENT_METRIC_RENAMES`) : questions des formulaires
//     (`submission.metrics.<cle>`, version courante et versions figees ; l'id de
//     la question ne change pas, les reponses deja donnees restent lisibles),
//     anciennes `metrics` d'un evenement pas encore migre au modele standard,
//     `rankingMetricKey`, soumissions (`metrics`), releves d'equipe
//     (`metricSnapshots`, nouvel id puis suppression de l'ancien) et leaderboard ;
//   - champs de l'update du jeudi (`CHECKIN_FIELD_RENAMES`) dans `checkins` et dans
//     les questions des formulaires (`checkin.<champ>`) : un champ retire du
//     registre ferait echouer l'ouverture du formulaire. A lancer JUSTE APRES le
//     deploiement des functions (l'ancien code ne connait pas les nouvelles cles).
//     Les releves et courbes de la startup suivent par le rattrapage :
//     `node scripts/backfill-kpis.mjs <batchId> --prod` APRES ce script.
// `revenue` / `totalRevenue` de l'update (Spring 2026) ne bougent pas : historique.
// Rejouable : une cle deja standard n'est plus touchee. Une metrique `firstCustomers`
// (payants OU signes) n'a pas d'equivalent sur : signalee, a trancher a la main.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { EVENT_METRIC_RENAMES, CHECKIN_FIELD_RENAMES } = require("../functions/lib/shared/presets/standardMetrics.js");
const { COL, docPaths, eventCollectionPaths } = require("../functions/lib/shared/collections.js");

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
if (!batchId) {
  console.error("usage: node scripts/migrate-metric-keys.mjs <batchId> [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${batchId} · ${write ? "ECRITURE" : "a blanc"}\n`);

/** Les ecritures a faire : `{ path, kind: "set" | "update" | "delete", data, note }`. */
const ops = [];
const warnings = [];
const renamed = (key) => EVENT_METRIC_RENAMES[key] ?? null;
const CHECKIN = "checkin.";
/** Les adresses a renommer : prefixe -> anciennes cles. Un champ `checkin.*` retire du registre ferait echouer le formulaire. */
const QUESTION_RENAMES = [
  [CHECKIN, CHECKIN_FIELD_RENAMES],
  ["submission.metrics.", EVENT_METRIC_RENAMES],
];
/** Ce qui n'a pas d'equivalent sur, a trancher a la main. */
const MANUAL = {
  "checkin.revenue": "historique : a remplacer par totalAmountPaid / mrr",
  "checkin.totalRevenue": "historique : a remplacer par totalAmountPaid / mrr",
  "submission.metrics.firstCustomers": "payants OU signes : a scinder en closedWon + loisSigned",
};

/** Les questions renommees, ou `null` si aucune ne change. */
function renameQuestions(questions, where) {
  let changed = false;
  const out = (questions ?? []).map((q) => {
    if (typeof q.dbField !== "string") return q;
    if (MANUAL[q.dbField]) warnings.push(`${where} : question « ${q.label} » (${q.dbField}) ${MANUAL[q.dbField]}`);
    for (const [prefix, renames] of QUESTION_RENAMES) {
      const to = q.dbField.startsWith(prefix) ? renames[q.dbField.slice(prefix.length)] : undefined;
      if (to) {
        changed = true;
        return { ...q, dbField: `${prefix}${to}` };
      }
    }
    return q;
  });
  return changed ? out : null;
}

/** La carte des metriques renommee, ou `null` si rien ne change. Deux anciennes cles sur la meme : la premiere garde. */
function renameMetricMap(metrics, where) {
  if (!metrics || typeof metrics !== "object") return null;
  const out = {};
  let changed = false;
  for (const [key, value] of Object.entries(metrics)) {
    const to = renamed(key) ?? key;
    if (to !== key) changed = true;
    if (to in out) {
      warnings.push(`${where} : ${key} et une autre cle deviennent ${to} ; ${key} = ${value} ecarte`);
      continue;
    }
    out[to] = value;
  }
  return changed ? out : null;
}

// ---- Evenements, soumissions, leaderboards ----
const events = (await db.collection(COL.events).where("batchId", "==", batchId).get()).docs;
for (const doc of events) {
  const e = doc.data();
  const patch = {};
  if (e.rankingMetricKey && renamed(e.rankingMetricKey)) patch.rankingMetricKey = renamed(e.rankingMetricKey);
  // Evenement pas encore passe au modele standard : ses anciennes metriques.
  if (Array.isArray(e.metrics) && e.metrics.some((m) => renamed(m.key))) {
    const seen = new Set();
    patch.metrics = e.metrics
      .map((m) => ({ ...m, key: renamed(m.key) ?? m.key }))
      .filter((m) => (seen.has(m.key) ? false : seen.add(m.key)));
  }
  if (Object.keys(patch).length) ops.push({ path: doc.ref.path, kind: "update", data: patch, note: Object.keys(patch).join(", ") });

  const [subs, board] = await Promise.all([db.collection(eventCollectionPaths.submissions(doc.id)).get(), db.doc(docPaths.leaderboard(doc.id)).get()]);
  for (const s of subs.docs) {
    const metrics = renameMetricMap(s.get("metrics"), s.ref.path);
    if (metrics) ops.push({ path: s.ref.path, kind: "update", data: { metrics }, note: Object.keys(metrics).join(", ") });
  }
  const boardKey = board.get("metric")?.key;
  if (boardKey && renamed(boardKey)) {
    ops.push({ path: board.ref.path, kind: "update", data: { "metric.key": renamed(boardKey) }, note: `${boardKey} -> ${renamed(boardKey)}` });
  }
}

// ---- Formulaires (version courante et versions figees) ----
const forms = (await db.collection(COL.forms).where("batchId", "==", batchId).get()).docs;
for (const doc of forms) {
  const questions = renameQuestions(doc.get("questions"), doc.ref.path);
  if (questions) ops.push({ path: doc.ref.path, kind: "update", data: { questions }, note: "questions" });
  const fields = (doc.get("questions") ?? []).map((q) => q.dbField ?? "");
  if (fields.some((f) => f.startsWith(CHECKIN)) && !fields.includes("checkin.callsMade")) {
    warnings.push(`${doc.ref.path} : update du jeudi a l'ancienne (sans pipeline) : le recreer depuis le modele « Thursday update »`);
  }
  const versions = await doc.ref.collection("versions").get();
  for (const v of versions.docs) {
    const vq = renameQuestions(v.get("questions"), v.ref.path);
    if (vq) ops.push({ path: v.ref.path, kind: "update", data: { questions: vq }, note: "questions" });
  }
}

// ---- Releves d'equipe : la cle est dans l'id, on deplace ----
const snapshots = (await db.collection(COL.metricSnapshots).where("batchId", "==", batchId).get()).docs;
const existing = new Set(snapshots.map((d) => d.ref.path));
for (const doc of snapshots) {
  const s = doc.data();
  const to = s.subjectType === "event_team" ? renamed(s.metric) : null;
  if (!to) continue;
  const path = docPaths.metricSnapshot(s.subjectId, to, s.dayString, s.phase ?? null);
  if (!existing.has(path)) ops.push({ path, kind: "set", data: { ...s, metric: to }, note: `${s.metric} -> ${to}` });
  ops.push({ path: doc.ref.path, kind: "delete", note: `remplace par ${path}` });
}

// ---- Updates du jeudi ----
const checkins = (await db.collection(COL.checkins).where("batchId", "==", batchId).get()).docs;
for (const doc of checkins) {
  const c = doc.data();
  const patch = {};
  for (const [from, to] of Object.entries(CHECKIN_FIELD_RENAMES)) {
    if (!(from in c)) continue;
    if (!(to in c) || c[to] === null) patch[to] = c[from];
    patch[from] = FieldValue.delete();
  }
  if (Object.keys(patch).length) ops.push({ path: doc.ref.path, kind: "update", data: patch, note: Object.keys(CHECKIN_FIELD_RENAMES).filter((f) => f in c).join(", ") });
}

// ---- Rapport, puis ecriture ----
const count = (kind) => ops.filter((o) => o.kind === kind).length;
for (const o of ops) console.log(`${o.kind.padEnd(6)} ${o.path}  (${o.note})`);
for (const w of warnings) console.log(`ATTENTION ${w}`);
console.log(`\n${ops.length} ecriture(s) : ${count("update")} mise(s) a jour, ${count("set")} creation(s), ${count("delete")} suppression(s).`);

if (!write) {
  console.log("A blanc : rien n'est ecrit. Relancer avec --prod pour ecrire.");
  process.exit(0);
}
for (let i = 0; i < ops.length; i += 400) {
  const batch = db.batch();
  for (const o of ops.slice(i, i + 400)) {
    const ref = db.doc(o.path);
    if (o.kind === "set") batch.set(ref, o.data);
    else if (o.kind === "update") batch.update(ref, o.data);
    else batch.delete(ref);
  }
  await batch.commit();
}
console.log(`Ecrit. Suite : node scripts/backfill-kpis.mjs ${batchId} --prod (releves et courbes des startups).`);
