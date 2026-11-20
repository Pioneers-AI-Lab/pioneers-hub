import { getFirestore, type Transaction, type WriteBatch } from "firebase-admin/firestore";
import { COL } from "../shared/collections";
import { auditLine, type AuditActor, type AuditEntry } from "../shared/audit";

// ----------------------------
// services - le journal d'audit
// ----------------------------
// CHAQUE ecriture d'un service laisse une ligne `auditLogs` (SPECS §4.7 : qui,
// quoi, quand, et la source), DANS LA MEME TRANSACTION que l'ecriture : une
// ecriture sans trace ou une trace sans ecriture sont toutes deux impossibles.
// Une ligne = une responsabilite, jamais la donnee (shared/audit.ts).

export type { AuditActor };

/** Un uid seul : une action de l'interface (callable, `via: "ui"`). */
export const actorOf = (actor: string | AuditActor): AuditActor => (typeof actor === "string" ? { uid: actor, apiKeyId: null, via: "ui" } : actor);

/** `tx` : la transaction de l'ecriture, ou son lot (synchro de l'agenda). */
export function writeAudit(tx: Transaction | WriteBatch, actor: AuditActor, entry: AuditEntry): void {
  tx.create(getFirestore().collection(COL.auditLogs).doc(), auditLine(actor, entry));
}

/**
 * Ligne d'audit d'une action d'un service partage : depuis l'interface (un uid,
 * `via: "ui"`) ou l'API (l'appelant, son canal et sa cle). Dans la transaction
 * `tx` si elle est fournie, sinon ecrite seule.
 */
export function writeUiAudit(
  tx: Transaction | null,
  by: string | AuditActor,
  action: string,
  targetPaths: string | readonly string[],
  fields: readonly string[] = [],
): Promise<unknown> {
  const entry: AuditEntry = { action, targetPaths: typeof targetPaths === "string" ? [targetPaths] : targetPaths, fields };
  if (!tx) return getFirestore().collection(COL.auditLogs).doc().create(auditLine(actorOf(by), entry));
  writeAudit(tx, actorOf(by), entry);
  return Promise.resolve();
}
