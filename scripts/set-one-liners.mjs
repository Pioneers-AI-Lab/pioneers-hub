// ----------------------------
// One-liners des fondateurs (`founders.trackRecordOneLiner`)
// ----------------------------
// node scripts/set-one-liners.mjs <one-liners.json> [--overwrite]          a blanc, projet reel (lecture seule)
// node scripts/set-one-liners.mjs <one-liners.json> [--overwrite] --prod   ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/set-one-liners.mjs ... [--prod]   emulateurs
//
// Fichier : { "<founderId>": "Une phrase." }. La phrase s'affiche sous le nom
// dans la grille et la liste de l'annuaire, et en tete de fiche. Le staff seul
// la modifie ensuite (« Edit profile » > Staff only) ; le fondateur, non
// (decision du 16/11). FA26 : textes rediges en session Claude depuis le track
// record de chacun (pas de cle API), fichier hors depot.
//
// Remplit le vide ; `--overwrite` remplace aussi un texte existant. Un id
// inconnu arrete le script avant toute ecriture.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Code partage compile (`npm --prefix functions run build`).
const require = createRequire(import.meta.url);
const { isEmptyValue } = require("../functions/lib/shared/fieldRegistry.js");
const { docPaths } = require("../functions/lib/shared/collections.js");

const args = process.argv.slice(2);
const filePath = args.find((a) => a.endsWith(".json"));
const write = args.includes("--prod");
const overwrite = args.includes("--overwrite");
if (!filePath) {
  console.error("usage: node scripts/set-one-liners.mjs <one-liners.json> [--overwrite] [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${write ? "ECRITURE" : "a blanc"}${overwrite ? " · remplace l'existant" : ""}\n`);

const texts = Object.entries(JSON.parse(readFileSync(filePath, "utf8")));
const snaps = await db.getAll(...texts.map(([id]) => db.doc(docPaths.founder(id))));
const missing = snaps.filter((s) => !s.exists).map((s) => s.id);
if (missing.length) throw new Error(`fondateurs inconnus : ${missing.join(", ")}`);

const now = new Date().toISOString();
const batch = db.batch();
let count = 0;
texts.forEach(([, text], i) => {
  const snap = snaps[i];
  const current = snap.get("trackRecordOneLiner");
  const next = text.trim();
  if (!next || current === next || (!isEmptyValue(current) && !overwrite)) return;
  console.log(`${snap.get("name")} : ${next}${isEmptyValue(current) ? "" : `\n  (remplace : ${current})`}`);
  batch.update(snap.ref, { trackRecordOneLiner: next, updatedDateISOString: now });
  count++;
});
if (write && count) await batch.commit();
console.log(`\n${count} one-liner(s) ${write ? "ecrit(s)" : "a ecrire (relancer avec --prod)"}.`);
