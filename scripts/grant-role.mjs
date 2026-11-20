// ----------------------------
// Attribuer un role sur le projet REEL (pioneers-3627c)
// ----------------------------
// npm run grant -- <email> staff
// npm run grant -- <email> investor ic|portfolio
// npm run grant -- <email> mentor
// npm run grant -- <email> none            (retire tous les roles)
//
// Si le compte n'existe pas encore, il est cree avec cet email : a sa premiere
// connexion Google avec la meme adresse, Firebase rattache Google a ce compte
// et le role est deja la. Ensuite, la page Staff > Access fait la meme chose
// depuis l'interface (pour les comptes deja connectes).

import { createRequire } from "node:module";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

// La ligne d'audit : la meme forme que le serveur (npm --prefix functions run build).
const { auditLine } = createRequire(import.meta.url)("../functions/lib/shared/audit.js");

const PROJECT_ID = "pioneers-3627c";
const ROLES = ["staff", "investor", "mentor"];

const [emailArg, role, access] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
if (!email || !role || (role !== "none" && !ROLES.includes(role))) {
  console.error("usage: npm run grant -- <email> staff|investor|mentor|none [ic|portfolio]");
  process.exit(1);
}
if (role === "investor" && !["ic", "portfolio"].includes(access)) {
  console.error("investor: preciser le niveau d'acces, ic ou portfolio");
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (err) {
  if (err.code !== "auth/user-not-found") throw err;
  user = await auth.createUser({ email });
  console.log(`  account created for ${email} (uid ${user.uid})`);
}

const ref = db.doc(`users/${user.uid}`);
const now = new Date().toISOString();
const snap = await ref.get();
if (!snap.exists) {
  await ref.set({
    personId: null,
    roles: [],
    investorAccess: null,
    loginCount: 0,
    createdDateISOString: now,
    lastSeenDateISOString: now,
  });
}

if (role === "none") {
  await ref.update({ roles: [], investorAccess: null });
} else {
  await ref.update({
    roles: FieldValue.arrayUnion(role),
    ...(role === "investor" ? { investorAccess: access } : {}),
  });
}
const after = (await ref.get()).data();
// Meme trace que Admin > Access : qui (le script), quelle action, sur quel compte, quand. Jamais l'e-mail ni le role.
await db.collection("auditLogs").add(
  auditLine({ uid: "script:grant-role", via: "script", apiKeyId: null }, { action: "set_account_access", targetPaths: [ref.path], fields: ["roles", "investorAccess"] }),
);
console.log(`grant: ${email} -> roles [${after.roles.join(", ")}], investorAccess ${after.investorAccess}`);
