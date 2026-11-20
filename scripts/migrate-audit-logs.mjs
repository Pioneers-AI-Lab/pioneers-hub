// ----------------------------
// Journal d'audit : une ligne = une responsabilite, 7 jours (20/11)
// ----------------------------
// node scripts/migrate-audit-logs.mjs          a blanc, projet reel (lecture seule)
// node scripts/migrate-audit-logs.mjs --prod   ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/migrate-audit-logs.mjs [--prod]   emulateurs
//
// Deux etapes, DANS CET ORDRE (la seconde efface ce que la premiere sauve) :
//
// 1. Notes du jury supprimees avant le 20/11 : leur seule copie etait la ligne
//    `evaluation.delete` (`payload.before`). Chacune rejoint la corbeille de son
//    evenement (`events/{eventId}/deletedEvaluations/{id de la ligne}`), comme le
//    fait desormais `deleteJuryScore` : restaurable depuis Admin > Events.
// 2. Chaque ligne de l'ancien format (`targetPath`, `payload`, sans `expireAt`)
//    passe au format de shared/audit.ts : `targetPaths`, `fields` (les NOMS des
//    champs de l'entree, jamais les valeurs), `onBehalfOf`, `expireAt` = sa date
//    + 7 jours. `payload` est retire. Une ligne de plus de 7 jours expire donc
//    aussitot : la politique TTL la supprime dans les 24 h.
//
// Rejouable : une note deja dans la corbeille (meme id) n'est pas recopiee, une
// ligne deja au nouveau format n'est plus touchee.
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { COL, eventCollectionPaths } = require("../functions/lib/shared/collections.js");
const { AUDIT_RETENTION_DAYS, auditLine, inputFieldsOf } = require("../functions/lib/shared/audit.js");

const write = process.argv.includes("--prod");
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${write ? "ECRITURE" : "a blanc"}\n`);

const logs = (await db.collection(COL.auditLogs).get()).docs;
const old = logs.filter((d) => d.get("expireAt") === undefined);
console.log(`${logs.length} lignes, dont ${old.length} a l'ancien format`);

// ---- 1. Les notes supprimees rejoignent la corbeille --------------------------
const deletions = old.filter((d) => d.get("action") === "evaluation.delete" && d.get("payload")?.before);
let saved = 0;
for (const line of deletions) {
  const [, eventId, , evaluationId] = String(line.get("targetPath")).split("/");
  const binRef = db.doc(`${eventCollectionPaths.deletedEvaluations(eventId)}/${line.id}`);
  if ((await binRef.get()).exists) continue;
  const deleted = {
    evaluation: line.get("payload").before,
    evaluationId,
    deletedByUid: line.get("actorUid"),
    deletedDateISOString: line.get("dateISOString"),
  };
  console.log(`  corbeille  ${binRef.path}  (${deleted.evaluation.evaluatorName} -> ${deleted.evaluation.targetId}, supprimee le ${deleted.deletedDateISOString})`);
  if (write) await binRef.create(deleted);
  saved++;
}
console.log(`1. ${deletions.length} notes supprimees dans le journal, ${saved} ${write ? "recopiees" : "a recopier"} dans la corbeille\n`);

// L'ordre tient seul : une copie qui echoue (`create`) arrete le script avant l'etape 2.

// ---- 2. Les lignes passent au format « responsabilite » -----------------------
// La forme de shared/audit.ts#auditLine, datee de la ligne d'origine (son `expireAt` en decoule).
let expired = 0;
const writer = db.bulkWriter();
for (const line of old) {
  const payload = line.get("payload") ?? {};
  const actorUid = line.get("actorUid");
  const migrated = auditLine(
    { uid: actorUid, via: line.get("via"), apiKeyId: line.get("apiKeyId") ?? null },
    {
      action: line.get("action"),
      targetPaths: String(line.get("targetPath") ?? "").split(", ").filter(Boolean),
      // Les noms des champs, jamais les valeurs : l'entree de l'API, les champs d'une reponse, ou rien.
      fields: payload.input !== undefined ? inputFieldsOf(payload.input) : [...(payload.applied ?? []), ...(payload.pending ?? [])],
      onBehalfOf: payload.judgeId && !String(actorUid).startsWith("jury:") ? `jury:${payload.judgeId}` : null,
      idempotencyKey: line.get("idempotencyKey") ?? null,
    },
    new Date(line.get("dateISOString")),
  );
  if (migrated.expireAt.getTime() <= Date.now()) expired++;
  if (write) writer.update(line.ref, { ...migrated, targetPath: FieldValue.delete(), payload: FieldValue.delete() });
}
await writer.close();
console.log(`2. ${old.length} lignes ${write ? "migrees" : "a migrer"} (sans valeurs), dont ${expired} de plus de ${AUDIT_RETENTION_DAYS} jours : supprimees par le TTL dans les 24 h`);
if (!write) console.log("\nA blanc : relancer avec --prod pour ecrire.");
