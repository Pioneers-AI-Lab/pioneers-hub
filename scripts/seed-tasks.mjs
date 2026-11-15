// ----------------------------
// Taches de depart du To do d'un batch (`batchTasks`, decision du 15/11)
// ----------------------------
// node scripts/seed-tasks.mjs fall-2026            a blanc, projet reel (lecture seule)
// node scripts/seed-tasks.mjs fall-2026 --prod     ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/seed-tasks.mjs fall-2026 [--prod]   emulateurs
//
// Trois taches communes au batch, cochees ensuite par chaque fondateur :
//   - « Introduce yourself on Slack » : l'espace Slack du batch
//     (`batch.settings.slackTeamId`, shared/slackLinks.ts), sans lien s'il n'est
//     pas regle (Admin > Batch settings, puis la tache dans Admin > Tasks) ;
//   - « Update your LinkedIn: Founder in Residence at Pioneers » : son profil LinkedIn ;
//   - « Finish your co-founder shortlist » : l'annuaire Founders de l'app (meme
//     chemin que lib/paths.ts#founders).
// Ids `{batchId}_{cle}` (docIds.starterTask) : rejouable, une tache deja en base
// n'est JAMAIS ecrasee (le staff a pu la modifier ou l'archiver). Les nouvelles se
// rangent apres les taches existantes.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { COL, docIds } = require("../functions/lib/shared/collections.js");
const { slackWorkspaceUrl } = require("../functions/lib/shared/slackLinks.js");

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
if (!batchId) {
  console.error("usage: node scripts/seed-tasks.mjs <batchId> [--prod]");
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
const batchDoc = batchSnap.data();
const programId = batchDoc.programId;
const slackTeamId = batchDoc.settings?.slackTeamId ?? null;
if (!slackTeamId) console.log("attention : pas d'espace Slack (settings.slackTeamId), la tache Slack sera sans lien\n");

const STARTER_TASKS = [
  {
    key: "slack-intro",
    title: "Introduce yourself on Slack",
    description: "A short intro in the batch Slack: who you are, what you have built, what you are looking for.",
    linkUrl: slackTeamId ? slackWorkspaceUrl(slackTeamId) : null,
  },
  {
    key: "linkedin-fir",
    title: "Update your LinkedIn: Founder in Residence at Pioneers",
    description: "Add the position Founder in Residence at Pioneers to your experience.",
    linkUrl: "https://www.linkedin.com/in/me/",
  },
  {
    key: "cofounder-shortlist",
    title: "Finish your co-founder shortlist",
    description: "Shortlist the founders you would like to build with, from the Founders directory.",
    linkUrl: `/programs/${programId}/batches/${batchId}/founders`,
  },
];

// Une lecture : les taches du batch (archivees comprises) donnent le dernier rang ET celles deja la.
const existingTasks = await db.collection(COL.batchTasks).where("batchId", "==", batchId).get();
const existingIds = new Set(existingTasks.docs.map((d) => d.id));
let order = Math.max(0, ...existingTasks.docs.map((d) => d.data().order ?? 0));
const refs = STARTER_TASKS.map((t) => db.doc(`${COL.batchTasks}/${docIds.starterTask(batchId, t.key)}`));
const now = new Date().toISOString();
const batch = db.batch();
let created = 0;
STARTER_TASKS.forEach((t, i) => {
  const exists = existingIds.has(refs[i].id);
  console.log(`${exists ? "deja la" : "cree   "}  ${refs[i].id.padEnd(36)} ${t.title}${t.linkUrl ? `  -> ${t.linkUrl}` : ""}`);
  if (exists) return;
  batch.create(refs[i], {
    programId,
    batchId,
    title: t.title,
    description: t.description,
    linkUrl: t.linkUrl,
    order: ++order,
    createdDateISOString: now,
    updatedDateISOString: now,
    archivedDateISOString: null,
  });
  created++;
});

if (!write) console.log(`\nA blanc : ${created} tache(s) a creer. Ajouter --prod pour ecrire.`);
else if (created > 0) {
  await batch.commit();
  console.log(`\n${created} tache(s) creee(s).`);
} else console.log("\nRien a creer.");
