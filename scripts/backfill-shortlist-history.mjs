// ----------------------------
// Rattrapage de l'historique des shortlists d'un batch : listes actuelles -> shortlistHistory
// ----------------------------
// node scripts/backfill-shortlist-history.mjs fall-2026            a blanc, projet reel (lecture seule)
// node scripts/backfill-shortlist-history.mjs fall-2026 --prod     ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/backfill-shortlist-history.mjs fall-2026 [--prod]   emulateurs
//
// Meme regle que le declencheur `onConnectionsWritten` (shared/shortlistHistory.ts) : un
// enregistrement par fondateur shortliste qui n'en a pas encore, date du rattrapage (la date
// de la premiere coche n'est pas connue). Ajout seul, rejouable : un enregistrement existant
// n'est jamais touche. Sert pour les shortlists faites avant le deploiement du declencheur.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { ALREADY_EXISTS, SHORTLIST_HISTORY_COLLECTION, shortlistRecordsToCreate } = require("../functions/lib/shared/shortlistHistory.js");
const { COL, docPaths } = require("../functions/lib/shared/collections.js");
const { readConnections } = require("../functions/lib/shared/types/connections.js");

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
if (!batchId) {
  console.error("usage: node scripts/backfill-shortlist-history.mjs <batchId> [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
const now = new Date().toISOString();

const [founders, history] = await Promise.all([
  db.collection(COL.founders).where("batchId", "==", batchId).get(),
  db.collection(SHORTLIST_HISTORY_COLLECTION).where("batchId", "==", batchId).get(),
]);
const existingIds = new Set(history.docs.map((d) => d.id));
const connections = founders.empty ? [] : await db.getAll(...founders.docs.map((f) => db.doc(docPaths.founderConnections(f.id))));

console.log(`${PROJECT_ID} · ${batchId} : ${founders.size} fondateurs, ${history.size} enregistrements deja la\n`);

const ops = [];
for (const [n, f] of founders.docs.entries()) {
  const lists = readConnections(connections[n].exists ? connections[n].data() : null);
  if (lists.shortlistedFounderIds.length === 0) continue;
  const founder = f.data();
  const records = shortlistRecordsToCreate(
    { programId: founder.programId, batchId: founder.batchId, founderId: f.id },
    lists.shortlistedFounderIds,
    existingIds,
    now,
  );
  console.log(`${(founder.name ?? f.id).slice(0, 30).padEnd(30)} shortlist ${String(lists.shortlistedFounderIds.length).padStart(2)}  a creer +${records.length}`);
  ops.push(...records);
}

console.log(`\n${ops.length} enregistrement(s) a creer.`);
if (!write) {
  console.log("A blanc : rien n'est ecrit (ajouter --prod pour ecrire).");
  process.exit(0);
}
const writer = db.bulkWriter();
// `create` : un enregistrement ecrit entre-temps par le declencheur (deja la : ALREADY_EXISTS) n'est jamais remplace.
writer.onWriteError((err) => err.code !== ALREADY_EXISTS && err.failedAttempts < 3);
const pending = Promise.allSettled(ops.map((r) => writer.create(db.doc(r.path), r.data)));
await writer.close();
const results = await pending;
const failed = results.filter((r) => r.status === "rejected" && r.reason?.code !== ALREADY_EXISTS);
if (failed.length) {
  console.error(`${failed.length} echec(s) :`, failed[0].reason);
  process.exit(1);
}
console.log(`Ecrit : ${results.filter((r) => r.status === "fulfilled").length} cree(s).`);
