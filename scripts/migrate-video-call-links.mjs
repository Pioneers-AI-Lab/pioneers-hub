// ----------------------------
// Migration : la visio d'un evenement a son champ (`videoCallUrl`, decision du 16/11)
// ----------------------------
// node scripts/migrate-video-call-links.mjs fall-2026          a blanc, projet reel (lecture seule)
// node scripts/migrate-video-call-links.mjs fall-2026 --prod   ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/migrate-video-call-links.mjs <batchId> [--prod]   emulateurs
//
// Avant, le lien Google Meet etait la ressource (`resourceUrl`). Un evenement
// dont la ressource est une visio (Meet, Zoom, Teams) la voit DEPLACEE dans
// `videoCallUrl` (la ressource se vide), sauf s'il a deja une visio. A lancer
// avec --prod une fois le front qui affiche `videoCallUrl` en ligne (l'ancien
// front ne montre que la ressource). Un evenement relie a l'agenda Google recoit
// de toute facon sa visio de la synchro. Rejouable.

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "node:module";

const { COL } = createRequire(import.meta.url)("../functions/lib/shared/collections.js");

const VIDEO_CALL = /^https:\/\/(meet\.google\.com|([\w-]+\.)?zoom\.us|teams\.microsoft\.com|teams\.live\.com)\//i;

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
if (!batchId) {
  console.error("usage: node scripts/migrate-video-call-links.mjs <batchId> [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${batchId} · ${write ? "ECRITURE" : "a blanc"}\n`);

const events = (await db.collection(COL.events).where("batchId", "==", batchId).get()).docs;
const ops = events.filter((e) => !e.get("videoCallUrl") && VIDEO_CALL.test(e.get("resourceUrl") ?? ""));
for (const e of ops) console.log(`${e.get("name")} (${e.id})\n  videoCallUrl : ${e.get("resourceUrl")}`);

console.log(`\n${events.length} evenement(s) lu(s) : ${ops.length} a deplacer.`);
if (!write) {
  console.log("A blanc : rien n'est ecrit. Relancer avec --prod pour ecrire.");
  process.exit(0);
}
const now = new Date().toISOString();
const batch = db.batch();
for (const e of ops) batch.update(e.ref, { videoCallUrl: e.get("resourceUrl"), resourceUrl: null, updatedDateISOString: now });
if (ops.length) await batch.commit();
console.log(`Ecrit : ${ops.length} evenement(s).`);
