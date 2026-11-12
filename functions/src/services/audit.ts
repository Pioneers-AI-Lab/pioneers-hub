import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { COL } from "../shared/collections";
import type { AuditLog, AuditSource } from "../shared/types";
import type { Caller } from "../api/caller";

// ----------------------------
// services - le journal d'audit
// ----------------------------
// CHAQUE ecriture d'un service laisse une ligne `auditLogs` (SPECS §4.7 : qui,
// quoi, quand, et la source), DANS LA MEME TRANSACTION que l'ecriture : une
// ecriture sans trace ou une trace sans ecriture sont toutes deux impossibles.

/** Qui ecrit : un appelant de l'API, ou un acteur construit (interface, formulaire, jure). */
type AuditActor = Pick<Caller, "uid" | "apiKeyId"> & { via: AuditSource };
type AuditEntry = { action: string; targetPath: string; payload: Record<string, unknown> | null; idempotencyKey: string | null };

const auditLog = (actor: AuditActor, entry: AuditEntry): AuditLog => ({
  actorUid: actor.uid,
  apiKeyId: actor.apiKeyId,
  via: actor.via,
  ...entry,
  dateISOString: new Date().toISOString(),
});

export function writeAudit(tx: Transaction, actor: AuditActor, entry: AuditEntry): void {
  tx.create(getFirestore().collection(COL.auditLogs).doc(), auditLog(actor, entry));
}

/**
 * Ligne d'audit d'une action faite depuis l'interface (callable, `via: "ui"`) :
 * dans la transaction `tx` si elle est fournie, sinon ecrite seule.
 */
export function writeUiAudit(
  tx: Transaction | null,
  actorUid: string,
  action: string,
  targetPath: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const actor: AuditActor = { uid: actorUid, apiKeyId: null, via: "ui" };
  const entry: AuditEntry = { action, targetPath, payload, idempotencyKey: null };
  if (!tx) return getFirestore().collection(COL.auditLogs).doc().create(auditLog(actor, entry));
  writeAudit(tx, actor, entry);
  return Promise.resolve();
}
