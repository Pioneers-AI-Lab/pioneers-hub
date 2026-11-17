// ----------------------------
// Repeat founders (`founderDirectory.repeatFounder`)
// ----------------------------
// node scripts/set-repeat-founders.mjs <repeat-founders.json> [--overwrite]          a blanc, projet reel (lecture seule)
// node scripts/set-repeat-founders.mjs <repeat-founders.json> [--overwrite] --prod   ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/set-repeat-founders.mjs ... [--prod]   emulateurs
//
// Fichier : { "<founderId>": true | false | null }. Oui = a deja fonde ou
// cofonde une entreprise AVANT son projet actuel ; `null` = non renseigne
// (rien n'est ecrit). FA26 : valeurs proposees en session Claude le 17/11
// depuis le track record, les entreprises et le projet de chacun (pas de cle
// API), fichier hors depot. Le fondateur corrige ensuite dans « Mon profil ».
//
// Remplit le vide ; `--overwrite` remplace aussi une reponse existante. Un id
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
  console.error("usage: node scripts/set-repeat-founders.mjs <repeat-founders.json> [--overwrite] [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${write ? "ECRITURE" : "a blanc"}${overwrite ? " · remplace l'existant" : ""}\n`);

const answers = Object.entries(JSON.parse(readFileSync(filePath, "utf8"))).filter(([, v]) => typeof v === "boolean");
// Une seule lecture : les fiches (le nom), puis leurs annuaires.
const snaps = await db.getAll(...answers.map(([id]) => db.doc(docPaths.founder(id))), ...answers.map(([id]) => db.doc(docPaths.founderDirectory(id))));
const founders = snaps.slice(0, answers.length);
const directories = snaps.slice(answers.length);
const missing = founders.filter((s) => !s.exists).map((s) => s.id);
if (missing.length) throw new Error(`fondateurs inconnus : ${missing.join(", ")}`);

const batch = db.batch();
let count = 0;
answers.forEach(([, next], i) => {
  const current = directories[i].get("repeatFounder");
  const empty = isEmptyValue(current);
  if (current === next || (!empty && !overwrite)) return;
  console.log(`${founders[i].get("name")} : ${next ? "yes" : "no"}${empty ? "" : ` (remplace : ${current ? "yes" : "no"})`}`);
  batch.set(directories[i].ref, { repeatFounder: next }, { merge: true });
  count++;
});
if (write && count) await batch.commit();
console.log(`\n${count} reponse(s) ${write ? "ecrite(s)" : "a ecrire (relancer avec --prod)"}.`);
