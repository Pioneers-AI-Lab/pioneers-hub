// ----------------------------
// Les formulaires hebdomadaires d'un batch, a la main (lot 4, shared/weeklyForms.ts)
// ----------------------------
// node scripts/create-weekly-forms.mjs fall-2026                          a blanc, projet reel (lecture seule), maintenant
// node scripts/create-weekly-forms.mjs fall-2026 --date 2026-11-26        a blanc, ce jeudi-la a 18:45 (Paris)
// node scripts/create-weekly-forms.mjs fall-2026 --date 2026-11-26 --prod ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/create-weekly-forms.mjs fall-2026 [--prod]   emulateurs
//
// Le MEME plan que la fonction programmee `weeklyForms` (chaque jeudi 18:45) : le Weekly update
// founder et le Weekly update startup, publies, ouverts a l'heure dite, echeance 24 h apres, ids
// `${batchId}-weekly-{founder|startup}-${jour}`. Un formulaire deja la n'est JAMAIS ecrase.
// Le batch doit avoir `settings.weeklyForms = { enabled: true, startDayString }` : sinon le plan
// dit pourquoi il ne cree rien (le script ne pose pas ce reglage).
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { COL } = require("../functions/lib/shared/collections.js");
const { eventFormDocs } = require("../functions/lib/shared/eventForms.js");
const { weeklyFormsOpening, weeklyFormsPlan } = require("../functions/lib/shared/weeklyForms.js");

const args = process.argv.slice(2);
const dateAt = args.indexOf("--date");
const day = dateAt >= 0 ? args[dateAt + 1] : null;
const batchId = args.find((a, i) => !a.startsWith("--") && i !== dateAt + 1);
const write = args.includes("--prod");
if (!batchId || (dateAt >= 0 && !/^\d{4}-\d{2}-\d{2}$/.test(day ?? ""))) {
  console.error("usage: node scripts/create-weekly-forms.mjs <batchId> [--date YYYY-MM-DD] [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${batchId} · ${write ? "ECRITURE" : "a blanc"}\n`);

const batchSnap = await db.doc(`${COL.batches}/${batchId}`).get();
if (!batchSnap.exists) {
  console.error(`batch introuvable : ${batchId}`);
  process.exit(1);
}
const nowISO = day ? weeklyFormsOpening(day) : new Date().toISOString();
const plan = weeklyFormsPlan({ ...batchSnap.data(), id: batchId }, nowISO);
if (plan.skip) {
  console.log(`rien a creer le ${plan.dayString} : ${plan.skip}`);
  process.exit(0);
}

for (const p of plan.plans) {
  const docs = eventFormDocs(p, new Date().toISOString());
  const exists = (await db.doc(docs[0].path).get()).exists;
  const { form } = p;
  console.log(`${exists ? "deja la " : write ? "cree    " : "a creer "} ${p.id}`);
  console.log(`         « ${form.title} » · ${form.questions.length} questions · ouvre ${form.opensDateISOString} · echeance ${form.deadlineDateISOString}`);
  if (exists || !write) continue;
  const batch = db.batch();
  for (const d of docs) batch.create(db.doc(d.path), d.data);
  await batch.commit();
}
if (!write) console.log("\na blanc : relancer avec --prod pour ecrire.");
