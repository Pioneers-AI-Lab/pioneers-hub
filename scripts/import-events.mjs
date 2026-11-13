// ----------------------------
// Import des evenements de data/events.json dans `events` (projet REEL)
// ----------------------------
// node scripts/import-events.mjs "Week 1"          a blanc : affiche ce qui serait cree
// node scripts/import-events.mjs "Week 1" --prod   ecrit
//
// Id du document = `key` du fichier : rejouable, un evenement deja en base
// n'est JAMAIS ecrase (le staff a pu le modifier ou y tirer des equipes).
// Le document est construit par shared/events.ts (`newEvent`), comme dans
// l'interface : un modele est un pack (son matching, sa duree). Ses formulaires
// (SPECS §2) le sont par shared/eventForms.ts : ceux du pack, plus les modeles
// de `forms` du fichier, nes comme l'evenement (publies s'il est programme, en
// brouillon sinon) ; le Debrief prend les `metrics` du fichier. Ids
// `{key}-{modele}` : un formulaire deja en base n'est jamais ecrase non plus.
//
// Sans heure (`startDateISOString` vide) : a l'heure par defaut de la mecanique
// (`defaultStartTime` : 12:30 pour une lunch roulette, heure de Spring 2026) ;
// hors lunch roulette, en brouillon, invisible des fondateurs tant que le staff
// n'a pas fixe l'heure.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { formOptions, parisLabel, readEventsFile, toEvent } from "./lib/eventsFile.mjs";

const require = createRequire(import.meta.url);
const { eventFormDocs, eventFormsPlan } = require("../functions/lib/shared/eventForms.js");

const PROJECT_ID = "pioneers-3627c";
const [week, flag] = process.argv.slice(2);
const write = flag === "--prod";
if (!week) {
  console.error('usage: node scripts/import-events.mjs "Week 1" [--prod]');
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("import-events: FIRESTORE_EMULATOR_HOST est defini, on viserait les emulateurs");

const { data, selected } = readEventsFile(week);

initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
const now = new Date().toISOString();

const events = selected.map((e) => ({ e, ev: toEvent(data, e, now) }));
// Le pack du modele, plus les formulaires de `forms` du fichier, avec ses reglages (scripts/lib/eventsFile.mjs).
const plans = events.flatMap(({ e, ev }) => eventFormsPlan(e.key, ev, formOptions(e), now));
const refs = selected.map((e) => db.doc(`events/${e.key}`));
const formDocs = plans.map((p) => eventFormDocs(p, now));
const formRefs = formDocs.map(([form]) => db.doc(form.path));
const [existing, existingForms] = await Promise.all([db.getAll(...refs), formRefs.length ? db.getAll(...formRefs) : []]);
const batch = db.batch();
let created = 0;
events.forEach(({ e, ev }, i) => {
  const exists = existing[i].exists;
  console.log(`${exists ? "deja la" : "cree   "}  ${e.key.padEnd(40)} ${parisLabel(ev.startDateISOString)}  ${ev.status.padEnd(9)} ${ev.name}`);
  if (!exists) {
    batch.create(refs[i], ev);
    created++;
  }
});
let formsCreated = 0;
plans.forEach((p, i) => {
  const exists = existingForms[i].exists;
  console.log(`${exists ? "deja la" : "cree   "}  form ${p.id.padEnd(35)} ${p.form.status.padEnd(9)} ${p.form.title} (${p.form.questions.length} questions)`);
  if (exists) return;
  for (const d of formDocs[i]) batch.create(db.doc(d.path), d.data);
  formsCreated++;
});

if (!write) console.log(`\nA blanc : ${created} evenement(s) et ${formsCreated} formulaire(s) a creer. Ajouter --prod pour ecrire.`);
else if (created + formsCreated > 0) {
  await batch.commit();
  console.log(`\n${created} evenement(s) et ${formsCreated} formulaire(s) cree(s).`);
} else console.log("\nRien a creer.");
