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
import { readFileSync } from "node:fs";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { EVENT_TEMPLATES } = require("../functions/lib/shared/presets/eventTemplates.js");
const { defaultStartTime, newEvent } = require("../functions/lib/shared/events.js");
const { eventFormDocs, eventFormsPlan } = require("../functions/lib/shared/eventForms.js");

const PROJECT_ID = "pioneers-3627c";
const [week, flag] = process.argv.slice(2);
const write = flag === "--prod";
if (!week) {
  console.error('usage: node scripts/import-events.mjs "Week 1" [--prod]');
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("import-events: FIRESTORE_EMULATOR_HOST est defini, on viserait les emulateurs");

const data = JSON.parse(readFileSync(new URL("../data/events.json", import.meta.url), "utf8"));
const selected = data.events.filter((e) => e.programWeek === week);
if (selected.length === 0) throw new Error(`Aucun evenement pour « ${week} »`);

/** Heure de Paris -> ISO. Les dates importees sont en hiver (UTC+1). */
const parisISO = (day, time) => new Date(`${day}T${time}:00+01:00`).toISOString();
const parisLabel = (iso) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 16);

function toEvent(e, now) {
  if (e.templateKey && !EVENT_TEMPLATES[e.templateKey]) throw new Error(`${e.key}: modele inconnu ${e.templateKey}`);
  const timeless = !e.startDateISOString;
  if (timeless && !e.dayString) throw new Error(`${e.key}: ni heure ni jour`);
  const event = newEvent(
    {
      programId: data.programId,
      batchId: data.batchId,
      templateKey: e.templateKey,
      kind: e.kind,
      name: e.name,
      startDateISOString: e.startDateISOString ?? parisISO(e.dayString, defaultStartTime(e.templateKey ?? null)),
      // Sans fin : la duree du modele.
      endDateISOString: e.endDateISOString ?? null,
      status: timeless && e.templateKey !== "lunch_roulette" ? "draft" : "scheduled",
      location: e.location,
    },
    {
      topic: e.topic,
      programWeek: e.programWeek,
      isMilestone: e.isMilestone,
      audience: e.audience,
      guests: e.guests,
      rankingMetricKey: e.rankingMetricKey ?? null,
    },
  );
  return { ...event, createdDateISOString: now, updatedDateISOString: now };
}

initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
const now = new Date().toISOString();

const events = selected.map((e) => ({ e, ev: toEvent(e, now) }));
// Le pack du modele, plus les formulaires de `forms` du fichier ; les metriques du fichier remplacent celles du modele.
const packForms = (e) => [...new Set([...(EVENT_TEMPLATES[e.templateKey]?.forms ?? []), ...(e.forms ?? [])])];
const plans = events.flatMap(({ e, ev }) => eventFormsPlan(e.key, ev, { forms: packForms(e), metrics: e.metrics ?? null }, now));
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
