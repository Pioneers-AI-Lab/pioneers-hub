// ----------------------------
// Migration vers le modele standard (SPECS §2, decision du 12/11)
// ----------------------------
// node scripts/migrate-standard-forms.mjs fall-2026            a blanc, projet reel (lecture seule)
// node scripts/migrate-standard-forms.mjs fall-2026 --prod     ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/migrate-standard-forms.mjs fall-2026 [--prod]   emulateurs
//
// Les evenements d'avant portaient leurs metriques (`metrics`), leur grille du
// jury (`criteria`) et leur demande de picks (`picks`). Pour chaque evenement du
// batch qui en a, le script cree ses formulaires (shared/eventForms.ts : Debrief,
// jury, picks ; fermes pour un evenement passe, pour garder la grille et les
// metriques lisibles ; a venir, ceux de son pack, nes comme l'evenement), ecrit
// son `matching` (deduit de son ancienne mecanique et de `teamSize`), puis
// RETIRE les anciens champs de l'evenement. Les formulaires propres a un evenement
// (Founder introductions, feedback) se creent depuis sa page d'administration.
// Les donnees saisies ne bougent pas : soumissions, avis entre pairs, notes du
// jury et picks restent dans leurs documents.
// Rejouable : un evenement deja migre n'a plus ces champs ; un formulaire deja
// en base (meme id `{evenement}-{modele}`) n'est jamais ecrase.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { eventFormDocs, eventFormsPlan } = require("../functions/lib/shared/eventForms.js");
const { matchingOf } = require("../functions/lib/shared/events.js");
const { docPaths } = require("../functions/lib/shared/collections.js");

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
if (!batchId) {
  console.error("usage: node scripts/migrate-standard-forms.mjs <batchId> [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
const now = new Date().toISOString();

// Anciens champs : grille, metriques et picks (-> formulaires), mecanique des outils (-> `matching`).
const LEGACY = ["metrics", "criteria", "picks", "teamSize", "evaluationTargetType"];
const events = (await db.collection("events").where("batchId", "==", batchId).get()).docs.filter(
  (d) => d.get("matching") === undefined || LEGACY.some((f) => d.get(f) !== undefined),
);
console.log(`${PROJECT_ID} · ${batchId} · ${events.length} evenement(s) avec d'anciens champs\n`);

const writes = [];
for (const doc of events) {
  const e = doc.data();
  const legacy = {
    metrics: Array.isArray(e.metrics) && e.metrics.length ? e.metrics : null,
    criteria: Array.isArray(e.criteria) && e.criteria.length ? e.criteria : null,
    picks: e.picks ?? null,
  };
  // Un evenement passe n'a que ce que portaient ses anciens champs (formulaires fermes) ;
  // a venir, aussi les formulaires par defaut de sa mecanique (Debrief, jury et picks en brouillon).
  const plans = eventFormsPlan(doc.id, e, { legacy }, now);
  const existing = plans.length ? await db.getAll(...plans.map((p) => db.doc(docPaths.form(p.id)))) : [];
  console.log(`${doc.id} · ${e.name}`);
  plans.forEach((p, i) => {
    const label = `  ${existing[i].exists ? "deja la" : "cree   "} form ${p.id} (${p.form.status}, ${p.form.questions.length} questions)`;
    console.log(label);
    if (existing[i].exists) return;
    for (const d of eventFormDocs(p, now)) writes.push((b) => b.create(db.doc(d.path), d.data));
  });
  // Le matching se deduit de l'ancienne mecanique et de la taille d'equipe, avant de retirer celle-ci.
  const matching = matchingOf(e);
  console.log(`  matching ${matching ? `${matching.mode} by ${matching.size.max}` : "aucun"} · retire ${LEGACY.filter((f) => e[f] !== undefined).join(", ") || "rien"}`);
  writes.push((b) => b.update(doc.ref, { matching, ...Object.fromEntries(LEGACY.map((f) => [f, FieldValue.delete()])) }));
}

if (!write) {
  console.log(`\nA blanc : ${writes.length} ecriture(s). Ajouter --prod pour ecrire.`);
} else {
  // Par lots de 400 (limite Firestore : 500 par lot).
  for (let i = 0; i < writes.length; i += 400) {
    const b = db.batch();
    for (const w of writes.slice(i, i + 400)) w(b);
    await b.commit();
  }
  console.log(`\n${writes.length} ecriture(s) faite(s).`);
}
