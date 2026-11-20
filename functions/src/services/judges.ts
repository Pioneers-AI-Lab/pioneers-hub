import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { docPaths, eventCollectionPaths } from "../shared/collections";
import type { DeletedEvaluation, Evaluation, JuryLink } from "../shared/types";
import { secret } from "../api/crypto";
import { writeUiAudit, actorOf, type AuditActor } from "./audit";
import { cleanId } from "./clean";
import { loadEvent } from "./events";

// ----------------------------
// services - le jury, cote staff (SPECS §4.2)
// ----------------------------
// Les notes se donnent par le formulaire de jury de l'evenement (services/forms.ts,
// identite `jury_link`, services/jury.ts) ; le verrou est la fermeture de ce
// formulaire. Restent au staff : le lien partage, la suppression d'une note
// saisie par erreur et sa restauration. Le leaderboard suit par le declencheur
// `onEvaluationWritten`.

const db = () => getFirestore();

/** Cree ou remplace le lien partage : l'ancien cesse de marcher aussitot. */
export async function resetJuryLink(actor: string | AuditActor, eventIdRaw: unknown): Promise<void> {
  const actorUid = actorOf(actor).uid;
  const eventId = cleanId(eventIdRaw, "eventId");
  await loadEvent(null, eventId);
  const ref = db().doc(docPaths.juryLink(eventId));
  await db().runTransaction(async (tx) => {
    const link: JuryLink = { secret: secret(), createdByUid: actorUid, createdDateISOString: new Date().toISOString() };
    tx.set(ref, link);
    // Jamais le secret dans l'audit.
    writeUiAudit(tx, actor, "reset_jury_link", ref.path, ["secret"]);
  });
}

/**
 * Supprime une note saisie par erreur : elle est DEPLACEE dans la corbeille de
 * l'evenement (`deletedEvaluations`), dans la meme transaction. Le classement ne
 * lit que `evaluations` (aucun lecteur ne peut compter une note retiree), et la
 * note se restaure. Le journal d'audit dit seulement qui l'a retiree.
 * Rend l'id de la note dans la corbeille.
 */
export async function deleteJuryScore(actor: string | AuditActor, eventIdRaw: unknown, evaluationIdRaw: unknown): Promise<string> {
  const eventId = cleanId(eventIdRaw, "eventId");
  const evaluationId = cleanId(evaluationIdRaw, "evaluationId");
  const ref = db().doc(`${eventCollectionPaths.evaluations(eventId)}/${evaluationId}`);
  const binRef = db().collection(eventCollectionPaths.deletedEvaluations(eventId)).doc();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "This score was already removed.");
    const deleted: DeletedEvaluation = {
      evaluation: snap.data() as Evaluation,
      evaluationId,
      deletedByUid: actorOf(actor).uid,
      deletedDateISOString: new Date().toISOString(),
    };
    tx.create(binRef, deleted);
    tx.delete(ref);
    writeUiAudit(tx, actor, "delete_jury_score", [ref.path, binRef.path]);
  });
  return binRef.id;
}

/**
 * Remet une note supprimee a sa place, telle qu'elle etait. Refusee si le jure a
 * note cette equipe depuis : sa nouvelle note fait foi.
 */
export async function restoreJuryScore(actor: string | AuditActor, eventIdRaw: unknown, deletedIdRaw: unknown): Promise<string> {
  const eventId = cleanId(eventIdRaw, "eventId");
  const binRef = db().doc(`${eventCollectionPaths.deletedEvaluations(eventId)}/${cleanId(deletedIdRaw, "deletedId")}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(binRef);
    if (!snap.exists) throw new HttpsError("not-found", "This deleted score does not exist (already restored?).");
    const { evaluation, evaluationId } = snap.data() as DeletedEvaluation;
    const ref = db().doc(`${eventCollectionPaths.evaluations(eventId)}/${evaluationId}`);
    if ((await tx.get(ref)).exists) throw new HttpsError("failed-precondition", "This judge has scored this team again since: the new score stands.");
    tx.create(ref, evaluation);
    tx.delete(binRef);
    writeUiAudit(tx, actor, "restore_jury_score", [ref.path, binRef.path]);
    return evaluationId;
  });
}
