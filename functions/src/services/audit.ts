import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { COL } from "../shared/collections";
import type { AuditLog } from "../shared/types";
import type { Caller } from "../api/caller";

// ----------------------------
// services - le journal d'audit
// ----------------------------
// CHAQUE ecriture d'un service laisse une ligne `auditLogs` (SPECS §4.7 : qui,
// quoi, quand, et la source), DANS LA MEME TRANSACTION que l'ecriture : une
// ecriture sans trace ou une trace sans ecriture sont toutes deux impossibles.

export function writeAudit(
  tx: Transaction,
  caller: Caller,
  entry: { action: string; targetPath: string; payload: Record<string, unknown> | null; idempotencyKey: string | null },
): void {
  const log: AuditLog = {
    actorUid: caller.uid,
    apiKeyId: caller.apiKeyId,
    via: caller.via,
    action: entry.action,
    targetPath: entry.targetPath,
    payload: entry.payload,
    idempotencyKey: entry.idempotencyKey,
    dateISOString: new Date().toISOString(),
  };
  tx.create(getFirestore().collection(COL.auditLogs).doc(), log);
}
