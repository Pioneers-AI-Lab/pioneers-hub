// ----------------------------
// Aligne `events` (et leurs formulaires) sur data/events.json, projet REEL
// ----------------------------
// node scripts/sync-events.mjs "Week 1"          a blanc : affiche ce qui changerait
// node scripts/sync-events.mjs "Week 1" --prod   ecrit
//
// Contrairement a import-events.mjs (qui cree sans jamais toucher a l'existant),
// ce script MET A JOUR un evenement deja en base sur le planning valide :
//   - les champs d'agenda : nom, description (`topic`), etiquette, modele, debut,
//     fin, lieu, statut (un brouillon devient programme quand l'heure est connue),
//     semaine, jalon, invites, bareme (`scoring`) ;
//   - le matching, SAUF si l'evenement a deja des equipes (on ne casse pas un tirage) ;
//   - les cles de `archived` (en tete du fichier) sont archivees, jamais supprimees.
// Ses formulaires (shared/eventForms.ts : le pack du modele, plus `forms` du
// fichier) sont crees s'ils manquent, et RECREES depuis le modele s'ils n'ont
// encore aucune reponse (un formulaire qui a des reponses n'est jamais touche).
// Un formulaire de l'evenement qui n'est plus prevu et n'a aucune reponse est archive.
//
// `formSettings` d'un evenement du fichier : par modele de formulaire, `opens` /
// `deadline` (heure de Paris, le jour de l'evenement) et `draft`.
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
  console.error('usage: node scripts/sync-events.mjs "Week 1" [--prod]');
  process.exit(1);
}
const onEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (onEmulator) console.log(`Emulateurs (${process.env.FIRESTORE_EMULATOR_HOST}) : projet de demo.`);

const { data, selected } = readEventsFile(week);

/** Les champs d'agenda que le planning fait foi ; le matching a part (equipes). */
const AGENDA_FIELDS = [
  "name",
  "topic",
  "kind",
  "templateKey",
  "stage",
  "startDateISOString",
  "endDateISOString",
  "location",
  "programWeek",
  "isMilestone",
  "audience",
  "guests",
  "guestFounderIds",
  "mentorIds",
  "scoring",
  "rankingMetricKey",
];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

if (!onEmulator) initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
else initializeApp({ projectId: "demo-pioneers-hub" });
const db = getFirestore();
const now = new Date().toISOString();

const ops = []; // { kind: "set" | "update", path, data }
const counts = { created: 0, updated: 0, unchanged: 0, archived: 0, formsCreated: 0, formsRecreated: 0, formsKept: 0, formsArchived: 0 };

/** Les formulaires qui ont deja des reponses (jamais touches), parmi `formIds`. */
async function withResponses(formIds) {
  const answered = await Promise.all(formIds.map(async (id) => [id, !(await db.collection("formResponses").where("formId", "==", id).limit(1).get()).empty]));
  return new Set(answered.filter(([, has]) => has).map(([id]) => id));
}

const snaps = await db.getAll(...selected.map((e) => db.doc(`events/${e.key}`)));
for (const [n, e] of selected.entries()) {
  const ev = toEvent(data, e, now);
  const snap = snaps[n];
  const when = `${parisLabel(ev.startDateISOString)}-${parisLabel(ev.endDateISOString).slice(11)}`;
  // Le matching qui vaut pour ses formulaires : celui du planning, sauf si des equipes sont deja tirees.
  let effective = ev;
  if (!snap.exists) {
    ops.push({ kind: "set", path: snap.ref.path, data: ev });
    counts.created++;
    console.log(`cree     ${e.key.padEnd(40)} ${when}  ${ev.name}`);
  } else {
    const current = snap.data();
    const patch = {};
    for (const f of AGENDA_FIELDS) if (!same(current[f], ev[f])) patch[f] = ev[f];
    if (current.status === "draft" && ev.status === "scheduled") patch.status = "scheduled";
    // Un evenement d'avant le 13/11 n'a pas le champ : il deduirait un tirage de son type. On l'ecrit.
    if (current.matching === undefined || !same(current.matching, ev.matching)) {
      const teams = await db.collection(`events/${e.key}/teams`).limit(1).get();
      if (teams.empty) patch.matching = ev.matching;
      else {
        effective = { ...ev, matching: current.matching };
        console.log(`  ! ${e.key} a deja des equipes : matching garde (${JSON.stringify(current.matching)})`);
      }
    }
    if (Object.keys(patch).length) {
      ops.push({ kind: "update", path: snap.ref.path, data: { ...patch, updatedDateISOString: now } });
      counts.updated++;
      console.log(`modifie  ${e.key.padEnd(40)} ${when}  ${Object.keys(patch).join(", ")}`);
    } else {
      counts.unchanged++;
      console.log(`inchange ${e.key.padEnd(40)} ${when}`);
    }
  }

  // Les formulaires de l'evenement, tels que le planning les prevoit, face a ceux deja en base.
  const plans = eventFormsPlan(e.key, effective, formOptions(e), now);
  const planned = new Set(plans.map((p) => p.id));
  const existing = new Map((await db.collection("forms").where("eventId", "==", e.key).get()).docs.map((d) => [d.id, d]));
  const answered = await withResponses([...existing.keys()]);
  for (const p of plans) {
    if (answered.has(p.id)) {
      counts.formsKept++;
      console.log(`  garde  form ${p.id.padEnd(46)} (a des reponses)`);
      continue;
    }
    for (const d of eventFormDocs(p, now)) ops.push({ kind: "set", path: d.path, data: d.data });
    const recreated = existing.has(p.id);
    counts[recreated ? "formsRecreated" : "formsCreated"]++;
    const dates = `${p.form.deadlineDateISOString ? `, echeance ${parisLabel(p.form.deadlineDateISOString)}` : ""}${p.form.opensDateISOString && p.form.status === "open" ? `, ouvre ${parisLabel(p.form.opensDateISOString)}` : ""}`;
    console.log(`  ${recreated ? "recree" : "cree  "} form ${p.id.padEnd(46)} ${p.form.status}${dates} · ${p.form.title} (${p.form.questions.length} q.)`);
  }
  // Un formulaire de l'evenement qui n'est plus prevu : archive s'il n'a aucune reponse.
  for (const [id, f] of existing) {
    if (planned.has(id) || f.data().archivedDateISOString) continue;
    if (answered.has(id)) {
      console.log(`  ! form ${id} n'est plus prevu mais a des reponses : garde`);
      continue;
    }
    ops.push({ kind: "update", path: f.ref.path, data: { archivedDateISOString: now, status: "closed", updatedDateISOString: now } });
    counts.formsArchived++;
    console.log(`  archive form ${id}`);
  }
}

const toArchive = data.archived ?? [];
for (const snap of toArchive.length ? await db.getAll(...toArchive.map((key) => db.doc(`events/${key}`))) : []) {
  if (!snap.exists || snap.data().archivedDateISOString) continue;
  ops.push({ kind: "update", path: snap.ref.path, data: { archivedDateISOString: now, updatedDateISOString: now } });
  counts.archived++;
  console.log(`archive  ${snap.id}`);
}

console.log(`\n${JSON.stringify(counts)}`);
if (!write && !onEmulator) {
  console.log(`A blanc : ${ops.length} ecriture(s). Ajouter --prod pour ecrire.`);
  process.exit(0);
}
for (let i = 0; i < ops.length; i += 400) {
  const batch = db.batch();
  for (const op of ops.slice(i, i + 400)) {
    if (op.kind === "set") batch.set(db.doc(op.path), op.data);
    else batch.update(db.doc(op.path), op.data);
  }
  await batch.commit();
}
console.log(`${ops.length} ecriture(s) faite(s).`);
