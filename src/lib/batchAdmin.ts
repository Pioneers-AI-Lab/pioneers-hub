import { getDoc } from "firebase/firestore";
import { listValuesWrite, newBatch, newProgram, type ExtensibleList, type NewBatchInput } from "@shared/admin/batch";
import { slugify } from "@shared/text";
import { docPaths } from "@shared/collections";
import { createWrite, RuleError } from "@shared/docWrites";
import type { Batch, BatchSettings, BatchStatus } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { commitWrites, patchDoc } from "@/lib/firestore/write";

// ----------------------------
// Programmes et batchs (staff)
// ----------------------------
// Les documents neufs : shared/admin/batch.ts, comme pour l'API (`create_program`,
// `create_batch`, `update_batch`, `add_list_values`).

export { slugify };

/** Un id deja pris : le message de l'ecran. */
const taken = (what: string, id: string) => (err: unknown) => {
  throw err instanceof RuleError && err.code === "already_exists" ? new Error(`A ${what} with the id "${id}" already exists.`) : err;
};

export async function createProgram(input: { id: string; name: string; description: string | null }) {
  const now = new Date().toISOString();
  await commitWrites([createWrite(docPaths.program(input.id), { ...newProgram(input), createdDateISOString: now, updatedDateISOString: now })]).catch(taken("program", input.id));
}

export async function createBatch(input: NewBatchInput & { id: string }) {
  const now = new Date().toISOString();
  await commitWrites([createWrite(docPaths.batch(input.id), { ...newBatch(input), createdDateISOString: now, updatedDateISOString: now })]).catch(taken("batch", input.id));
}

export async function updateBatch(
  batchId: string,
  patch: { status?: BatchStatus; settings?: BatchSettings; milestones?: Batch["milestones"]; endDayString?: string | null },
) {
  await patchDoc<Batch>(refs.batch(batchId), patch);
}

/** Ajoute a une liste fermee les valeurs qu'elle n'a pas encore (import) ; rend le nombre ajoute. */
export async function addListValues(key: ExtensibleList, values: string[]) {
  const { added, write } = listValuesWrite(key, (await getDoc(refs.list(key))).data(), values, new Date().toISOString());
  if (write) await commitWrites([write]);
  return added.length;
}
