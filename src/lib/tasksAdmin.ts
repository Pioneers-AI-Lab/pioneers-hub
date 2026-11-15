import { writeBatch } from "firebase/firestore";
import { isAppPath, normalizeHttpUrl } from "@shared/text";
import type { Batch, BatchTask, WithId } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";
import { createDoc, patchDoc } from "@/lib/firestore/write";

// ----------------------------
// Taches du To do (staff, Admin > Tasks)
// ----------------------------
// Ecriture directe (regle `batchTasks` : staff). Rien n'est supprime : retirer
// une tache l'archive ; les coches des fondateurs restent.

/** Ce que le staff regle sur une tache. */
export type TaskDraft = Pick<BatchTask, "title" | "description" | "linkUrl">;

/**
 * Le lien saisi : un chemin de l'app (`/programs/…`) tel quel, sinon une adresse
 * web (protocole complete, `shared/text.ts#normalizeHttpUrl`) ; vide = `null`.
 * `undefined` : ni l'un ni l'autre (a corriger).
 */
export function parseTaskLink(value: string): string | null | undefined {
  const text = value.trim();
  if (!text) return null;
  if (isAppPath(text)) return text;
  return normalizeHttpUrl(text) ?? undefined;
}

/** Nouvelle tache, en fin de liste ; rend son id. */
export function createTask(batch: WithId<Batch>, draft: TaskDraft, tasks: readonly WithId<BatchTask>[]): Promise<string> {
  const order = Math.max(0, ...tasks.map((t) => t.order)) + 1;
  return createDoc<BatchTask>(refs.batchTasks(), {
    ...draft,
    programId: batch.programId,
    batchId: batch.id,
    order,
    archivedDateISOString: null,
  });
}

export const updateTask = (task: WithId<BatchTask>, draft: TaskDraft) => patchDoc(refs.batchTask(task.id), draft);

/** Retire la tache du To do de tous les fondateurs (archive). */
export const archiveTask = (task: WithId<BatchTask>) =>
  patchDoc(refs.batchTask(task.id), { archivedDateISOString: new Date().toISOString() });

/**
 * Monte (`-1`) ou descend (`+1`) une tache dans la liste affichee (`tasks`, dans
 * l'ordre), puis renumerote 1..n en un lot : seules les taches dont le rang
 * change sont ecrites (deux rangs egaux ne bloquent donc jamais).
 */
export async function moveTask(tasks: readonly WithId<BatchTask>[], from: number, delta: -1 | 1) {
  const to = from + delta;
  if (to < 0 || to >= tasks.length) return;
  const next = [...tasks];
  [next[from], next[to]] = [next[to], next[from]];
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  next.forEach((t, i) => {
    if (t.order !== i + 1) batch.update(refs.batchTask(t.id), { order: i + 1, updatedDateISOString: now });
  });
  await batch.commit();
}
