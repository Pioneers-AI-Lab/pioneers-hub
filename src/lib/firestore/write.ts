import {
  addDoc,
  arrayRemove,
  arrayUnion,
  setDoc,
  type CollectionReference,
  type DocumentReference,
  type PartialWithFieldValue,
} from "firebase/firestore";
import type {
  BatchTask,
  FounderConnectionList,
  FounderConnections,
  TaskCompletion,
  Timestamps,
  User,
  UserPreferences,
  WithId,
} from "@shared/types";
import { refs } from "@/lib/firestore/refs";

// ----------------------------
// Ecritures generiques
// ----------------------------
// Les contextes ne font QUE lire. Toute ecriture passe par ces fonctions (ou
// par une callable quand elle doit etre validee cote serveur), qui posent
// l'horodatage au meme endroit pour tout le monde.

const nowISO = () => new Date().toISOString();

/** Fusionne `patch` dans le document et met a jour `updatedDateISOString`. */
export async function patchDoc<T extends Timestamps>(ref: DocumentReference<WithId<T>>, patch: Partial<T>) {
  await setDoc(ref, { ...patch, updatedDateISOString: nowISO() } as PartialWithFieldValue<WithId<T>>, { merge: true });
}

/** Cree un document a id choisi (slug, id deterministe) avec ses horodatages. */
export async function createDocWithId<T extends Timestamps>(
  ref: DocumentReference<WithId<T>>,
  data: Omit<T, keyof Timestamps>,
) {
  const now = nowISO();
  await setDoc(ref, { ...data, createdDateISOString: now, updatedDateISOString: now, id: ref.id } as WithId<T>);
}

/** Cree un document a id automatique avec ses horodatages ; rend son id. */
export async function createDoc<T extends Timestamps>(
  ref: CollectionReference<WithId<T>>,
  data: Omit<T, keyof Timestamps>,
): Promise<string> {
  const now = nowISO();
  const created = await addDoc(ref, { ...data, createdDateISOString: now, updatedDateISOString: now, id: "" } as WithId<T>);
  return created.id;
}

/** Fusionne des reglages dans `users/{uid}.preferences` (le compte lui-meme). */
export async function saveUserPreferences(uid: string, preferences: Partial<UserPreferences>) {
  await setDoc(refs.user(uid), { preferences } as PartialWithFieldValue<WithId<User>>, { merge: true });
}

/**
 * Coche ou decoche `targetFounderId` dans une liste (shortlist ou rencontres)
 * du fondateur `ownerFounderId` (le visiteur : lui seul l'ecrit, firestore.rules).
 * Fusion : la premiere coche cree le document avec sa seule liste.
 */
export async function setFounderConnection(ownerFounderId: string, list: FounderConnectionList, targetFounderId: string, on: boolean) {
  await setDoc(
    refs.founderConnections(ownerFounderId),
    { [list]: on ? arrayUnion(targetFounderId) : arrayRemove(targetFounderId), updatedDateISOString: nowISO() } as PartialWithFieldValue<WithId<FounderConnections>>,
    { merge: true },
  );
}

// ---- Taches du To do ----

/** Le fondateur coche (ou decoche) une tache de son batch : un document par tache et par fondateur. */
export async function setTaskDone(task: WithId<BatchTask>, founderId: string, done: boolean) {
  const ref = refs.taskCompletion(task.id, founderId);
  const completion: WithId<TaskCompletion> = {
    id: ref.id,
    programId: task.programId,
    batchId: task.batchId,
    taskId: task.id,
    founderId,
    done,
    updatedDateISOString: nowISO(),
  };
  await setDoc(ref, completion);
}
