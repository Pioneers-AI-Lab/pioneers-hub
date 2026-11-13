// ----------------------------
// Rattrapage de `formCompletions` depuis les `formResponses` existantes
// ----------------------------
// node scripts/backfill-form-completions.mjs           a blanc, projet reel (lecture seule)
// node scripts/backfill-form-completions.mjs --prod    ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/backfill-form-completions.mjs [--prod]   emulateurs
//
// `submitFormResponse` ecrit le « J'ai repondu » du fondateur avec sa reponse ;
// les reponses d'avant n'en ont pas, et leurs formulaires reapparaitraient dans
// le « To do ». Une completion par formulaire et fondateur, depuis sa reponse la
// plus recente. Rejouable : une completion deja en base n'est jamais ecrasee.
// Les reponses anonymes (`respondentFounderId` nul) sont ignorees, par principe.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { COL, docIds, docPaths } = require("../functions/lib/shared/collections.js");

const write = process.argv.includes("--prod");
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
const CHUNK = 300;

const responses = await db
  .collection(COL.formResponses)
  .where("respondentFounderId", "!=", null)
  .select("programId", "batchId", "formId", "formKind", "respondentFounderId", "submittedDateISOString")
  .get();

/** Derniere reponse par formulaire et fondateur. */
const latest = new Map();
for (const snap of responses.docs) {
  const r = snap.data();
  const id = docIds.formCompletion(r.formId, r.respondentFounderId);
  const known = latest.get(id);
  if (!known || known.r.submittedDateISOString < r.submittedDateISOString) latest.set(id, { responseId: snap.id, r });
}

const refOf = ({ r }) => db.doc(docPaths.formCompletion(r.formId, r.respondentFounderId));
const entries = [...latest.values()];
const existing = new Set();
for (let i = 0; i < entries.length; i += CHUNK) {
  const snaps = await db.getAll(...entries.slice(i, i + CHUNK).map(refOf));
  snaps.filter((s) => s.exists).forEach((s) => existing.add(s.ref.path));
}

const missing = entries.filter((e) => !existing.has(refOf(e).path));
console.log(`${PROJECT_ID} : ${responses.size} reponses nominatives, ${entries.length} couples formulaire-fondateur, ${missing.length} completions a creer.`);
for (const e of missing) console.log(`  + ${refOf(e).path}`);

if (!write) {
  console.log("A blanc : rien n'est ecrit (--prod pour ecrire).");
  process.exit(0);
}

for (let i = 0; i < missing.length; i += CHUNK) {
  const batch = db.batch();
  for (const e of missing.slice(i, i + CHUNK)) {
    batch.create(refOf(e), {
      programId: e.r.programId,
      batchId: e.r.batchId,
      formId: e.r.formId,
      founderId: e.r.respondentFounderId,
      formKind: e.r.formKind,
      responseId: e.responseId,
      completedDateISOString: e.r.submittedDateISOString,
    });
  }
  await batch.commit();
}
console.log(`${missing.length} completions ecrites.`);
