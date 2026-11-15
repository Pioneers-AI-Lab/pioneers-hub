// ----------------------------
// Migration : Education d'un texte libre vers une liste (decision du 15/11)
// ----------------------------
// node scripts/migrate-education-tags.mjs fall-2026            a blanc, projet reel (lecture seule)
// node scripts/migrate-education-tags.mjs --all                a blanc, tous les batchs
// node scripts/migrate-education-tags.mjs fall-2026 --prod     ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/migrate-education-tags.mjs --all [--prod]   emulateurs
//
// `founders/{id}/private/directory.education` : un texte (« HEC Paris; ESSEC »,
// « South Dakota State University · ESADE MBA ») devient une liste, decoupee
// par `splitTextList` (shared/text.ts, la regle de l'import) : `;` et ` · `
// seulement, jamais `-` ni `,`. Un texte vide ou absent devient `[]`.
// Rejouable : une valeur deja en liste n'est pas touchee. Affiche avant -> apres.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { splitTextList } = require("../functions/lib/shared/text.js");
const { COL, docPaths } = require("../functions/lib/shared/collections.js");

const args = process.argv.slice(2);
const all = args.includes("--all");
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
if (!all === !batchId) {
  console.error("usage: node scripts/migrate-education-tags.mjs <batchId|--all> [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${all ? "tous les batchs" : batchId} · ${write ? "ECRITURE" : "a blanc"}\n`);

const founders = (await (all ? db.collection(COL.founders) : db.collection(COL.founders).where("batchId", "==", batchId)).get()).docs;
const directories = founders.length ? await db.getAll(...founders.map((f) => db.doc(docPaths.founderDirectory(f.id)))) : [];

/** Les ecritures a faire : `{ path, education }`. */
const ops = [];
let alreadyList = 0;
for (const [i, dir] of directories.entries()) {
  if (!dir.exists) continue;
  const before = dir.get("education");
  if (Array.isArray(before)) {
    alreadyList += 1;
    continue;
  }
  const after = splitTextList(before);
  ops.push({ path: dir.ref.path, education: after });
  console.log(`${founders[i].get("name") ?? founders[i].id} (${dir.ref.path})\n  avant : ${JSON.stringify(before ?? null)}\n  apres : ${JSON.stringify(after)}`);
}

console.log(`\n${directories.length} annuaire(s) lu(s) : ${ops.length} a migrer, ${alreadyList} deja en liste.`);
if (!write) {
  console.log("A blanc : rien n'est ecrit. Relancer avec --prod pour ecrire.");
  process.exit(0);
}
for (let i = 0; i < ops.length; i += 400) {
  const batch = db.batch();
  for (const o of ops.slice(i, i + 400)) batch.update(db.doc(o.path), { education: o.education });
  await batch.commit();
}
console.log(`Ecrit : ${ops.length} annuaire(s).`);
