// ----------------------------
// Configuration d'emulateurs DECALEE, pour les verifications
// ----------------------------
// `npm run check:api` tourne A COTE des emulateurs de dev (`npm run emulators`) :
// memes produits, memes regles, ports decales de +200 (ou CHECK_PORT_OFFSET,
// quand une autre verification occupe deja +200). Le fichier est tire de
// firebase.json a chaque lancement, donc il ne peut pas diverger.

import { readFileSync, writeFileSync } from "node:fs";

const OFFSET = Number(process.env.CHECK_PORT_OFFSET ?? 200);

const config = JSON.parse(readFileSync("firebase.json", "utf8"));
for (const [name, value] of Object.entries(config.emulators)) {
  if (value && typeof value === "object" && "port" in value) value.port += OFFSET;
  if (name === "ui") value.enabled = false;
}
// Le build est fait par le script npm, pas a chaque rechargement.
for (const fn of config.functions) delete fn.predeploy;
writeFileSync(".firebase-check.json", `${JSON.stringify(config, null, 2)}\n`);
