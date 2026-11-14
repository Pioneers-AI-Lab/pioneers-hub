// ----------------------------
// Recopie la prod dans les emulateurs locaux (essais sur les vraies donnees)
// ----------------------------
// npm run emulators            (ou `npm run emulators:local`, qui garde les donnees d'un lancement a l'autre)
// node scripts/pull-prod.mjs   puis `npm run dev:emu` : l'app tourne sur la copie, bandeau « local db »
//
// LIT le projet reel (`pioneers-3627c`, Application Default Credentials), n'y ecrit JAMAIS, puis ECRIT dans les
// emulateurs du projet de demo (`demo-pioneers-hub`, Firestore 8180, Auth 9199), qu'il vide d'abord.
//   - Firestore : toutes les collections et sous-collections, sauf les secrets et le bruit de la prod
//     (cles d'API, jetons OAuth du connecteur Claude, plans MCP, cles d'idempotence, journal d'audit).
//   - Auth : les memes comptes, aux memes uid (les roles staff, investor... vivent dans `users/{uid}`).
//     Un compte Google se choisit dans la fenetre Google de l'emulateur ; un compte email / mot de passe
//     prend le mot de passe local LOCAL_PASSWORD (l'emulateur ne lit pas les empreintes de la prod).
//   - Storage n'est pas copie : les photos de couverture gardent leur URL a jeton de la prod.
//
// Donnees personnelles : elles ne vivent que dans les emulateurs (et dans `.emulator-data/` avec
// `emulators:local`, ignore par git). Ne jamais les commiter ni les partager.

import { initializeApp, applicationDefault, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROD = "pioneers-3627c";
const LOCAL = "demo-pioneers-hub";
const FIRESTORE_EMU = process.env.LOCAL_FIRESTORE_HOST ?? "127.0.0.1:8180";
const AUTH_EMU = process.env.LOCAL_AUTH_HOST ?? "127.0.0.1:9199";
const LOCAL_PASSWORD = "pioneers-local";
/** Secrets et bruit de la prod : jamais recopies. */
const SKIPPED = new Set(["apiKeys", "writePlans", "idempotencyKeys", "auditLogs", "oauthClients", "oauthRequests", "oauthCodes", "oauthGrants", "oauthTokens"]);

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("pull-prod : retirer FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST : la lecture de la prod passerait par les emulateurs.");
}

// ---- 1. Lecture de la prod (aucune ecriture) ----
const prodApp = initializeApp({ projectId: PROD, credential: applicationDefault() }, "prod");
const prodDb = getFirestore(prodApp);

/** Tous les documents d'une collection et de ses sous-collections, en profondeur. */
async function readTree(collection, out) {
  const snap = await collection.get();
  await Promise.all(
    snap.docs.map(async (doc) => {
      out.push({ path: doc.ref.path, data: doc.data() });
      for (const sub of await doc.ref.listCollections()) await readTree(sub, out);
    }),
  );
  // Un document « fantome » (sans champs) peut porter des sous-collections : on les lit aussi.
  for (const ref of await collection.listDocuments()) {
    if (snap.docs.some((d) => d.id === ref.id)) continue;
    for (const sub of await ref.listCollections()) await readTree(sub, out);
  }
}

const docs = [];
const roots = (await prodDb.listCollections()).filter((c) => !SKIPPED.has(c.id));
for (const c of roots) await readTree(c, docs);

const users = [];
let pageToken;
do {
  const page = await getAuth(prodApp).listUsers(1000, pageToken);
  users.push(...page.users);
  pageToken = page.pageToken;
} while (pageToken);
await deleteApp(prodApp);
console.log(`Prod lue : ${docs.length} documents (${roots.map((c) => c.id).join(", ")}), ${users.length} comptes.`);

// ---- 2. Ecriture dans les emulateurs (vides d'abord) ----
const reset = async (url) => {
  const r = await fetch(url, { method: "DELETE", headers: { authorization: "Bearer owner" } });
  if (!r.ok) throw new Error(`Emulateur injoignable (${url}) : lancer \`npm run emulators\` d'abord. ${r.status}`);
};
await reset(`http://${FIRESTORE_EMU}/emulator/v1/projects/${LOCAL}/databases/(default)/documents`);
await reset(`http://${AUTH_EMU}/emulator/v1/projects/${LOCAL}/accounts`);

process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMU;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMU;
const localApp = initializeApp({ projectId: LOCAL }, "local");
const localDb = getFirestore(localApp);
const writer = localDb.bulkWriter();
for (const d of docs) writer.set(localDb.doc(d.path), d.data);
await writer.close();

const auth = getAuth(localApp);
const imported = users.map((u) => ({
  uid: u.uid,
  email: u.email,
  emailVerified: u.emailVerified,
  displayName: u.displayName,
  photoURL: u.photoURL,
  disabled: u.disabled,
  customClaims: u.customClaims,
  providerData: u.providerData
    .filter((p) => p.providerId !== "password")
    .map((p) => ({ uid: p.uid, email: p.email, displayName: p.displayName, photoURL: p.photoURL, providerId: p.providerId })),
}));
for (let i = 0; i < imported.length; i += 1000) {
  const r = await auth.importUsers(imported.slice(i, i + 1000));
  for (const e of r.errors) console.warn(`  compte ${imported[i + e.index].email ?? imported[i + e.index].uid} : ${e.error.message}`);
}
const withPassword = users.filter((u) => u.providerData.some((p) => p.providerId === "password"));
for (const u of withPassword) await auth.updateUser(u.uid, { password: LOCAL_PASSWORD });

console.log(`Emulateurs remplis : ${docs.length} documents, ${users.length} comptes.`);
if (withPassword.length) console.log(`Comptes email / mot de passe : mot de passe local « ${LOCAL_PASSWORD} ».`);
console.log("Lancer l'app sur la copie : npm run dev:emu");
