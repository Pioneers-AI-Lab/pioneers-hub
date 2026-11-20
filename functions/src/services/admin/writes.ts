import { getFirestore, type Transaction } from "firebase-admin/firestore";
import type { DocWrite } from "../../shared/docWrites";
import { writtenFieldsOf } from "../../shared/audit";
import { isStaffViewer } from "../../shared/access";
import type { Caller } from "../../api/caller";
import { notFound } from "../../api/errors";
import { plain, type OperationPlan } from "../operations";

// ----------------------------
// services/admin - executer les gestes de l'Admin dans une transaction
// ----------------------------
// Les gestes se calculent dans shared/admin/*.ts (logique pure, la meme que le
// front) ; ce fichier les ecrit avec l'Admin SDK, dans la transaction de
// l'operation (services/operations.ts : apercu, confirmation, audit).

/** Ecrit les ecritures d'un geste dans la transaction. */
export function applyWrites(tx: Transaction, writes: readonly DocWrite[]): void {
  const db = getFirestore();
  for (const w of writes) {
    const ref = db.doc(w.path);
    if (w.op === "delete") tx.delete(ref);
    else if (w.op === "create") tx.create(ref, plain(w.data));
    else if (w.op === "merge") tx.set(ref, plain(w.data), { merge: true });
    else tx.set(ref, plain(w.data));
  }
}

export const pathsOf = (writes: readonly DocWrite[]) => [...new Set(writes.map((w) => w.path))];

/** Les gestes de l'Admin : staff seulement (regles `events`, `forms`, `batchTasks`, `attendance`...). */
export const staffOnly = (caller: Caller) => isStaffViewer(caller.viewer);

/** Un document lu dans la transaction, avec son id ; `undefined` s'il n'existe pas. */
export async function readDoc<T>(tx: Transaction, path: string): Promise<(T & { id: string }) | undefined> {
  const snap = await tx.get(getFirestore().doc(path));
  return snap.exists ? ({ ...(snap.data() as T), id: snap.id } as T & { id: string }) : undefined;
}

/** Comme `readDoc`, mais l'absence est une erreur 404 (`<object>_not_found`). */
export async function mustRead<T>(tx: Transaction, path: string, object: string, field: string): Promise<T & { id: string }> {
  const doc = await readDoc<T>(tx, path);
  if (!doc) throw notFound(`${object}_not_found`, `No ${object} \`${path.split("/").pop()}\`.`, field);
  return doc;
}

/** Les documents d'une requete d'egalite, avec leur id. */
export async function readWhere<T>(tx: Transaction, collection: string, field: string, value: unknown): Promise<(T & { id: string })[]> {
  const snap = await tx.get(getFirestore().collection(collection).where(field, "==", value));
  return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
}

/**
 * Le plan d'un geste : son apercu, ses ecritures et ce qu'il rend. `changed`
 * faux (deja dans l'etat demande) : rien a ecrire, pas de plan a confirmer.
 */
export const writePlan = <R>(preview: unknown, writes: readonly DocWrite[], result: R, changed = writes.length > 0): OperationPlan<R> => ({
  preview,
  targetPaths: pathsOf(writes),
  fields: writtenFieldsOf(writes),
  commit: changed
    ? (tx) => {
        applyWrites(tx, writes);
        return result;
      }
    : null,
});

/**
 * Le plan d'une action HORS transaction (services des callables : comptes,
 * agenda, jury, classement) : l'apercu, puis l'effet, qui ecrit lui-meme son
 * audit au nom de l'appelant (`selfAudited` faux : la ligne d'audit de l'API).
 * `changed` faux : rien a faire, pas de plan.
 */
export const effectPlan = <R>(preview: unknown, targetPaths: string[], effect: () => Promise<R>, changed = true, selfAudited = true): OperationPlan<R> =>
  changed ? { preview, targetPaths, effect, effectAudits: selfAudited } : { preview, targetPaths };

/** Un id tire sans lecture (collection().doc()), pour une creation : jamais dans l'apercu. */
export const newDocId = (collection: string) => getFirestore().collection(collection).doc().id;

/** `{ champ: { from, to } }` pour les champs qui changent : l'apercu montre ce qui bouge, sans horodatage. */
export function changesOf(before: object, after: object): Record<string, { from: unknown; to: unknown }> {
  const was = before as Record<string, unknown>;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    if (to === undefined) continue;
    const from = was[key] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) out[key] = { from, to };
  }
  return out;
}

/** Les champs horodates d'une creation. */
export const stamped = <T extends object>(data: T, now: string) => ({ ...data, createdDateISOString: now, updatedDateISOString: now });
