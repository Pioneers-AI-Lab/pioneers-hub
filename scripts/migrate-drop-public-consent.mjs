// ----------------------------
// Retrait de `founders.publicProfileConsent` (decision du 17/11)
// ----------------------------
// node scripts/migrate-drop-public-consent.mjs          a blanc, projet reel (lecture seule)
// node scripts/migrate-drop-public-consent.mjs --prod   ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/migrate-drop-public-consent.mjs [--prod]   emulateurs
//
// Les fiches fondateur sont publiques pour tous : le champ ne veut plus rien
// dire, mais l'API le rendrait encore (`get` renvoie le document tel quel).
// Supprime le champ sur tous les batchs. Rejouable.

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const write = process.argv.includes("--prod");
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${write ? "ECRITURE" : "a blanc"}\n`);

const snaps = (await db.collection("founders").get()).docs.filter((d) => d.get("publicProfileConsent") !== undefined);
if (write) {
  const writer = db.bulkWriter();
  for (const d of snaps) writer.update(d.ref, { publicProfileConsent: FieldValue.delete() });
  await writer.close();
}
console.log(`${snaps.length} fiche(s) ${write ? "nettoyee(s)" : "a nettoyer (relancer avec --prod)"}.`);
