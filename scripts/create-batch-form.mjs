// ----------------------------
// Cree un formulaire de batch (sans evenement) depuis un modele, publie, avec ses dates
// ----------------------------
// node scripts/create-batch-form.mjs <batchId> <templateKey> --id <formId> --opens <ISO> --deadline <ISO>          a blanc
// node scripts/create-batch-form.mjs ... --prod                                                                       ecrit (projet reel)
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/create-batch-form.mjs ... --prod                                emulateurs
//
// Construit comme `create_form` (services/formCreate.ts) : `newForm` puis `firstPublication`, verifie par
// `formProblems`. Id fixe (`--id`) : rejouable, n'ecrase jamais un formulaire existant. Ex. Lock my team
// du 17/11 : fall-2026 lock_my_team --id fall-2026-lock-my-team --opens 2026-11-23T15:00:00Z --deadline 2026-11-25T08:30:00Z.
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { newForm, firstPublication } = require("../functions/lib/shared/forms.js");
const { formProblems } = require("../functions/lib/shared/formRules.js");
const { FORM_TEMPLATES } = require("../functions/lib/shared/presets/formTemplates.js");

const args = process.argv.slice(2);
const [batchId, templateKey] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
};
const formId = flag("--id");
const opens = flag("--opens");
const deadline = flag("--deadline");
const write = args.includes("--prod");
if (!batchId || !templateKey || !formId || !opens || !deadline) {
  console.error("usage: node scripts/create-batch-form.mjs <batchId> <templateKey> --id <formId> --opens <ISO> --deadline <ISO> [--prod]");
  process.exit(1);
}
const template = FORM_TEMPLATES[templateKey];
if (!template) throw new Error(`Modele inconnu : ${templateKey}`);
if (template.needsEvent) throw new Error(`Le modele ${templateKey} se rattache a un evenement : utiliser sync-events.`);

const onEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();

const batch = (await db.doc(`batches/${batchId}`).get()).data();
if (!batch) throw new Error(`Batch inconnu : ${batchId}`);
const ref = db.doc(`forms/${formId}`);
if ((await ref.get()).exists) {
  console.log(`${formId} existe deja : rien a faire.`);
  process.exit(0);
}
const now = new Date().toISOString();
const draft = newForm(
  { programId: batch.programId, batchId, templateKey, eventId: null, event: null },
  { opensDateISOString: new Date(opens).toISOString(), deadlineDateISOString: new Date(deadline).toISOString() },
);
const problem = formProblems(draft)[0];
if (problem) throw new Error(`Formulaire invalide : ${problem}`);
const published = firstPublication(draft, now);
console.log(`${PROJECT_ID} · ${batchId} · ${formId} · « ${draft.title} » · ${draft.questions.length} questions · ouvre ${draft.opensDateISOString} · echeance ${draft.deadlineDateISOString}`);
if (!write) {
  console.log("A blanc : rien n'est ecrit (ajouter --prod pour ecrire).");
  process.exit(0);
}
const wb = db.batch();
wb.create(ref, { ...published.form, createdDateISOString: now, updatedDateISOString: now });
wb.create(ref.collection("versions").doc(String(published.version.version)), published.version);
await wb.commit();
console.log("Ecrit.");
