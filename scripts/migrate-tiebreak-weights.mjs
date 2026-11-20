// ----------------------------
// Un critere de departage n'a pas de poids (20/11)
// ----------------------------
// node scripts/migrate-tiebreak-weights.mjs <batchId>          a blanc, projet reel (lecture seule)
// node scripts/migrate-tiebreak-weights.mjs <batchId> --prod   ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/migrate-tiebreak-weights.mjs <batchId> [--prod]   emulateurs
//
// Les formulaires de jury du H3 et du H4 (data/events.json, depuis le 14/11) portaient un poids 1
// sur leurs criteres de departage (« weight 1 » dans l'editeur : un total de 101 ou 102). Avec un
// bareme, le poids n'est pas lu : le classement n'a jamais bouge. Retire ce poids (`null`) des
// questions de jury dont le critere est « tie-break only » au bareme de leur evenement, version
// courante et versions figees. Rejouable : une question deja sans poids n'est plus touchee.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { COL } = require("../functions/lib/shared/collections.js");
const { criterionKeyOf } = require("../functions/lib/shared/fieldRegistry.js");
const { isJuryCriterion } = require("../functions/lib/shared/formRules.js");
const { tieBreaksOf } = require("../functions/lib/shared/scoringRules.js");

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--"));
const write = args.includes("--prod");
if (!batchId) {
  console.error("usage: node scripts/migrate-tiebreak-weights.mjs <batchId> [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${batchId} · ${write ? "ECRITURE" : "a blanc"}\n`);

const [events, forms] = await Promise.all(
  [COL.events, COL.forms].map(async (col) => (await db.collection(col).where("batchId", "==", batchId).get()).docs),
);
/** Les departages du bareme de chaque evenement du batch (la cle d'un element est celle de son critere). */
const tieBreaksByEvent = new Map(events.map((d) => [d.id, new Set(tieBreaksOf(d.get("scoring")?.items ?? []))]));

/** Le poids retire des departages : `{ path, questions, keys }`, ou `null` si aucune question ne change. */
function withoutTieBreakWeights(path, questions, tieBreaks) {
  const keys = [];
  const out = (questions ?? []).map((q) => {
    const key = isJuryCriterion(q) ? criterionKeyOf(q.dbField) : null;
    if (!key || !tieBreaks.has(key) || q.weight == null) return q;
    keys.push(key);
    return { ...q, weight: null };
  });
  return keys.length ? { path, questions: out, keys } : null;
}

// Seuls les formulaires d'un evenement a departage ; leurs versions figees lues ensemble.
const withTieBreaks = forms.flatMap((doc) => {
  const tieBreaks = tieBreaksByEvent.get(doc.get("eventId"));
  return tieBreaks?.size ? [{ doc, tieBreaks }] : [];
});
const versions = await Promise.all(withTieBreaks.map(({ doc }) => doc.ref.collection("versions").get()));
const ops = withTieBreaks.flatMap(({ doc, tieBreaks }, i) =>
  [doc, ...versions[i].docs].map((d) => withoutTieBreakWeights(d.ref.path, d.get("questions"), tieBreaks)).filter(Boolean),
);

for (const o of ops) console.log(`update ${o.path}  (poids retire : ${o.keys.join(", ")})`);
console.log(`\n${ops.length} ecriture(s).`);
if (!write) {
  console.log("A blanc : rien n'est ecrit. Relancer avec --prod pour ecrire.");
  process.exit(0);
}
const batch = db.batch();
for (const o of ops) batch.update(db.doc(o.path), { questions: o.questions });
await batch.commit();
console.log("Ecrit.");
