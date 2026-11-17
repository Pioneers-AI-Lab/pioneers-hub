// ----------------------------
// Les formulaires hebdomadaires sur les entrees « Weekly Update Form » deja la (lot 4, decision du 18/11)
// ----------------------------
// node scripts/attach-weekly-forms.mjs fall-2026                   a blanc, projet reel (lecture seule)
// node scripts/attach-weekly-forms.mjs fall-2026 --prod            ecrit, projet reel
// node scripts/attach-weekly-forms.mjs fall-2026 --enable [--prod] pose d'abord `settings.weeklyForms = { enabled: true }`
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/attach-weekly-forms.mjs fall-2026 [--prod]   emulateurs
//
// La synchro de l'agenda (services/calendarSync.ts) accroche les formulaires a une entree qu'elle
// cree ou met a jour ; ce script applique LE MEME plan (shared/weeklyForms.ts#weeklyFormsPlan) aux
// evenements deja en base : template `weekly_update` sur chaque entree « Weekly Update Form » sans
// template, et ses formulaires manquants (Weekly update founder et startup, publies, ouverts a son
// debut, echeance 24 h apres, ids `<evenement>-<modele>`). Un formulaire deja la n'est JAMAIS
// ecrase ; une entree passee ou masquee ne recoit rien. Rejouable.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { COL } = require("../functions/lib/shared/collections.js");
const { eventFormDocs, formsByEventId } = require("../functions/lib/shared/eventForms.js");
const { isWeeklyUpdateEvent, weeklyFormsEnabled, weeklyFormsPlan } = require("../functions/lib/shared/weeklyForms.js");

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
const enable = args.includes("--enable");
if (!batchId) {
  console.error("usage: node scripts/attach-weekly-forms.mjs <batchId> [--enable] [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${batchId} · ${write ? "ECRITURE" : "a blanc"}\n`);

const batchRef = db.doc(`${COL.batches}/${batchId}`);
const batchSnap = await batchRef.get();
if (!batchSnap.exists) {
  console.error(`batch introuvable : ${batchId}`);
  process.exit(1);
}
const now = new Date().toISOString();
const stored = batchSnap.data();
console.log(`settings.weeklyForms : ${JSON.stringify(stored.settings?.weeklyForms ?? null)}`);
const batch = enable ? { ...stored, settings: { ...stored.settings, weeklyForms: { enabled: true } } } : stored;
if (!weeklyFormsEnabled(batch)) {
  console.log("le batch n'a pas settings.weeklyForms.enabled : rien a accrocher (--enable le pose).");
  process.exit(0);
}
if (enable) {
  console.log(`${write ? "pose" : "poserait"} settings.weeklyForms = { enabled: true } (l'ancien startDayString n'est plus lu)`);
  if (write) await batchRef.update({ "settings.weeklyForms": { enabled: true }, updatedDateISOString: now });
}

const byBatch = (col) => db.collection(col).where("batchId", "==", batchId).get();
const [eventSnaps, formSnaps] = await Promise.all([byBatch(COL.events), byBatch(COL.forms)]);
const formsOf = formsByEventId(formSnaps.docs.map((d) => ({ ...d.data(), id: d.id })));
const entries = eventSnaps.docs
  .map((d) => ({ ...d.data(), id: d.id }))
  .filter(isWeeklyUpdateEvent)
  .sort((a, b) => a.startDateISOString.localeCompare(b.startDateISOString));
if (entries.length === 0) console.log("aucune entree « Weekly Update Form » dans le batch.");

let created = 0;
for (const event of entries) {
  const eventForms = formsOf.get(event.id) ?? [];
  const { patch, forms } = weeklyFormsPlan(batch, event, eventForms, now);
  const hasPatch = Object.keys(patch).length > 0;
  const state = event.archivedDateISOString !== null ? " (masquee)" : "";
  console.log(`\n${event.id} · « ${event.name} » · ${event.startDateISOString}${state}`);
  for (const f of eventForms) console.log(`  deja la  ${f.id}`);
  if (!hasPatch && forms.length === 0) {
    console.log("  rien a faire (passee, masquee ou complete)");
    continue;
  }
  if (hasPatch) console.log(`  template : ${JSON.stringify(patch)}`);
  for (const p of forms) console.log(`  ${write ? "cree   " : "a creer"}  ${p.id} · « ${p.form.title} » · ouvre ${p.form.opensDateISOString} · echeance ${p.form.deadlineDateISOString}`);
  created += forms.length;
  if (!write) continue;
  const b = db.batch();
  if (hasPatch) b.update(db.doc(`${COL.events}/${event.id}`), { ...patch, updatedDateISOString: now });
  for (const p of forms) for (const d of eventFormDocs(p, now)) b.create(db.doc(d.path), d.data);
  await b.commit();
}
console.log(`\n${entries.length} entrees, ${created} formulaires ${write ? "crees" : "a creer"}.`);
if (!write) console.log("a blanc : relancer avec --prod pour ecrire.");
