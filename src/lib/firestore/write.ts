import { addDoc, setDoc, type CollectionReference, type DocumentReference, type PartialWithFieldValue } from "firebase/firestore";
import type { Timestamps, WithId } from "@shared/types";

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
