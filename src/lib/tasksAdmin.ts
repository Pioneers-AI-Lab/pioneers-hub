import { moveInList, newTask, taskOrderWrites, type TaskDraft } from "@shared/admin/batch";
import { docPaths } from "@shared/collections";
import { archiveWrite } from "@shared/docWrites";
import type { Batch, BatchTask, WithId } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { commitWrites, createDoc, patchDoc } from "@/lib/firestore/write";

// ----------------------------
// Taches du To do (staff, Admin > Tasks)
// ----------------------------
// Ecriture directe (regle `batchTasks` : staff). Les gestes : shared/admin/batch.ts,
// comme pour l'API (`create_task`, `update_task`, `move_task`, `archive_task`).
// Rien n'est supprime : retirer une tache l'archive ; les coches des fondateurs restent.

export { parseTaskLink, type TaskDraft } from "@shared/admin/batch";

/** Nouvelle tache, en fin de liste ; rend son id. */
export const createTask = (batch: WithId<Batch>, draft: TaskDraft, tasks: readonly WithId<BatchTask>[]): Promise<string> =>
  createDoc<BatchTask>(refs.batchTasks(), newTask(batch, draft, tasks));

export const updateTask = (task: WithId<BatchTask>, draft: TaskDraft) => patchDoc(refs.batchTask(task.id), draft);

/** Retire la tache du To do de tous les fondateurs (archive), ou la remet. */
export const archiveTask = (task: WithId<BatchTask>, archived = true) => commitWrites([archiveWrite(docPaths.batchTask(task.id), archived, new Date().toISOString())]);

/** Monte (`-1`) ou descend (`+1`) une tache dans la liste affichee (`tasks`, dans l'ordre), puis renumerote. */
export async function moveTask(tasks: readonly WithId<BatchTask>[], from: number, delta: -1 | 1) {
  const to = from + delta;
  if (to < 0 || to >= tasks.length) return;
  await commitWrites(taskOrderWrites(moveInList(tasks, from, to), new Date().toISOString()));
}
