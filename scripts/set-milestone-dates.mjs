// ----------------------------
// Echeances des milestones du score d'un batch -> `batches/{id}.settings.scoreMilestoneDueDates`
// ----------------------------
// node scripts/set-milestone-dates.mjs fall-2026            a blanc, projet reel (lecture seule)
// node scripts/set-milestone-dates.mjs fall-2026 --prod     ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/set-milestone-dates.mjs fall-2026 [--prod]   emulateurs
//
// Une milestone (Execution, shared/scoring.ts#founderMilestones) ne compte qu'une fois due ;
// sans echeance sur le batch, elle n'existe pas. Les echeances viennent de l'agenda : fa26 (17/11)
// Shortlist done et Met a la fin du debrief du H4 (23/11 16:30 Paris), Teamed up au kickoff
// du H5 (25/11 9:30), Problem validated le jour du Selection Day (17/12, heure pas encore dans
// l'agenda : debut de journee). Weekly goal (`weeklyGoalFrom`) : LU DANS L'AGENDA, l'echeance du
// DEUXIEME Weekly update du batch (shared/weeklyForms.ts#weeklyGoalFromOf : le premier objectif est
// donne au premier weekly, juge au suivant ; fa26 : 10/12 18:00 + 24 h = 2026-12-11T17:00:00.000Z).
// L'agenda deplace un Weekly update : relancer. Moins de deux entrees : le script s'arrete.
// N'ecrit QUE `settings.scoreMilestoneDueDates` (les autres reglages ne bougent pas). Rejouable.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
// Lit le code partage compile : `npm --prefix functions run build` avant.
const { COL } = require("../functions/lib/shared/collections.js");
const { weeklyGoalFromOf } = require("../functions/lib/shared/weeklyForms.js");

/** Les echeances par batch (ISO complet, UTC) ; `weeklyGoalFrom` vient des evenements du batch. */
const DUE_DATES = {
  "fall-2026": {
    shortlistDone: "2026-11-23T15:30:00.000Z",
    met: "2026-11-23T15:30:00.000Z",
    teamedUp: "2026-11-25T08:30:00.000Z",
    problemValidated: "2026-12-16T23:00:00.000Z",
  },
};

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
if (!batchId || !DUE_DATES[batchId]) {
  console.error(`usage: node scripts/set-milestone-dates.mjs <batchId> [--prod]   (batchs connus : ${Object.keys(DUE_DATES).join(", ")})`);
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${batchId} · ${write ? "ECRITURE" : "a blanc"}\n`);

const ref = db.doc(`batches/${batchId}`);
const snap = await ref.get();
if (!snap.exists) {
  console.error(`Batch ${batchId} introuvable.`);
  process.exit(1);
}
const events = (await db.collection(COL.events).where("batchId", "==", batchId).get()).docs.map((d) => d.data());
const weeklyGoalFrom = weeklyGoalFromOf(events);
if (!weeklyGoalFrom) {
  console.error("Moins de deux entrees « Weekly Update Form » dans le batch : pas de date Weekly goal, rien n'est ecrit.");
  process.exit(1);
}
const before = snap.get("settings.scoreMilestoneDueDates") ?? null;
const after = { ...DUE_DATES[batchId], weeklyGoalFrom };
console.log("avant :", JSON.stringify(before));
console.log("apres :", JSON.stringify(after));
if (!write) {
  console.log("\nA blanc : rien n'est ecrit (ajouter --prod pour ecrire).");
  process.exit(0);
}
// `update` avec un chemin pointe : seul ce reglage est remplace, le reste de `settings` reste.
await ref.update({ "settings.scoreMilestoneDueDates": after, updatedDateISOString: new Date().toISOString() });
console.log("\nEcrit.");
