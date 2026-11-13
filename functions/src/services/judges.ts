import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { docPaths, eventCollectionPaths } from "../shared/collections";
import type { JuryLink } from "../shared/types";
import { secret } from "../api/crypto";
import { writeUiAudit } from "./audit";
import { cleanId } from "./clean";
import { loadEvent } from "./events";

// ----------------------------
// services - le jury, cote staff (SPECS §4.2)
// ----------------------------
// Les notes se donnent par le formulaire de jury de l'evenement (services/forms.ts,
// identite `jury_link`, services/jury.ts) ; le verrou est la fermeture de ce
// formulaire. Restent au staff : le lien partage et la suppression d'une note
// saisie par erreur. Le leaderboard suit par le declencheur `onEvaluationWritten`.

const db = () => getFirestore();

/** Cree ou remplace le lien partage : l'ancien cesse de marcher aussitot. */
export async function resetJuryLink(actorUid: string, eventIdRaw: unknown): Promise<void> {
  const eventId = cleanId(eventIdRaw, "eventId");
  await loadEvent(null, eventId);
  const ref = db().doc(docPaths.juryLink(eventId));
  await db().runTransaction(async (tx) => {
    const replaced = (await tx.get(ref)).exists;
    const link: JuryLink = { secret: secret(), createdByUid: actorUid, createdDateISOString: new Date().toISOString() };
    tx.set(ref, link);
    // Jamais le secret dans l'audit.
    writeUiAudit(tx, actorUid, "jury.resetLink", ref.path, { replaced });
  });
}

/**
 * Supprime une note saisie par erreur. Exception assumee a « rien n'est
 * supprime » : la note entiere reste dans l'audit, et un document garde
 * fausserait le leaderboard.
 */
export async function deleteJuryScore(actorUid: string, eventIdRaw: unknown, evaluationIdRaw: unknown): Promise<void> {
  const eventId = cleanId(eventIdRaw, "eventId");
  const ref = db().doc(`${eventCollectionPaths.evaluations(eventId)}/${cleanId(evaluationIdRaw, "evaluationId")}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "This score was already removed.");
    tx.delete(ref);
    writeUiAudit(tx, actorUid, "evaluation.delete", ref.path, { before: snap.data() });
  });
}
