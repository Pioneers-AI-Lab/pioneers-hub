// ----------------------------
// Rattrapage : les absents masques des groupes publies (19/11)
// ----------------------------
// node scripts/sync-team-absences.mjs fall-2026            a blanc, projet reel (lecture seule)
// node scripts/sync-team-absences.mjs fall-2026 --prod     ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/sync-team-absences.mjs fall-2026 [--prod]   emulateurs
//
// Depuis le 19/11, le declencheur `onAttendanceWritten` (services/teamAbsences.ts) masque un absent
// de son groupe publie (`EventTeam.absentMemberIds`) et de l'historique (`Membership.masked`) a
// chaque absence posee ou levee. Ce script applique LE MEME plan (shared/admin/teams.ts#absenceWrites)
// aux evenements deja en base, marques avant le declencheur. Seuls les ecarts s'ecrivent ; rejouable.
// Chaque groupe ecrit declenche `onTeamWritten` : les leaderboards suivent.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.
import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { COL, eventCollectionPaths } = require("../functions/lib/shared/collections.js");
const { absenceWrites } = require("../functions/lib/shared/admin/teams.js");
const { absentFounderIds } = require("../functions/lib/shared/attendance.js");

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
if (!batchId) {
  console.error("usage: node scripts/sync-team-absences.mjs <batchId> [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${batchId} · ${write ? "ECRITURE" : "a blanc"}\n`);

const withId = (d) => ({ ...d.data(), id: d.id });
const events = (await db.collection(COL.events).where("batchId", "==", batchId).get()).docs;
let total = 0;
for (const event of events) {
  const teams = (await db.collection(eventCollectionPaths.teams(event.id)).get()).docs.map(withId);
  if (!teams.some((t) => t.publishedDateISOString)) continue;
  const [attendance, memberships] = await Promise.all([
    db.collection(eventCollectionPaths.attendance(event.id)).get(),
    db.collection(COL.memberships).where("eventId", "==", event.id).get(),
  ]);
  const absentIds = absentFounderIds(attendance.docs.map((d) => d.data()));
  const writes = absenceWrites(event.id, teams, memberships.docs.map(withId), absentIds);
  if (writes.length === 0) continue;
  total += writes.length;
  console.log(`${event.get("name")} (${event.id})`);
  for (const w of writes) console.log(`  ${w.path} <- ${JSON.stringify(w.data)}`);
  if (write) {
    const batch = db.batch();
    for (const w of writes) batch.set(db.doc(w.path), w.data, { merge: true });
    await batch.commit();
  }
}
console.log(`\n${total} ecriture(s)${write ? " faites" : " a faire (relancer avec --prod)"}.`);
