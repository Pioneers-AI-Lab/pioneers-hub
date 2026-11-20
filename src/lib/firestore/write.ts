import {
  arrayRemove,
  arrayUnion,
  doc,
  setDoc,
  runTransaction,
  writeBatch,
  type Transaction,
  type WriteBatch,
  type CollectionReference,
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
import { auditLineOfWrites } from "@shared/audit";
import { createWrite, RuleError, setWrite, type DocWrite } from "@shared/docWrites";
import { auth, db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";

// ----------------------------
// Ecritures generiques
// ----------------------------
// Les contextes ne font QUE lire. Toute ecriture passe par ces fonctions (ou
// par une callable quand elle doit etre validee cote serveur), qui posent
// l'horodatage au meme endroit pour tout le monde.

const nowISO = () => new Date().toISOString();

/**
 * La ligne d'audit d'un geste de l'Admin (shared/audit.ts : qui, quelle action,
 * quels documents, quels champs ; jamais la donnee), au nom du compte connecte.
 * Ecrite DANS le lot du geste : le geste et sa trace passent ou echouent ensemble
 * (firestore.rules#auditLineOk en verifie la forme). `import` : un import CSV.
 */
function auditWrite(action: string, writes: readonly DocWrite[], via: "ui" | "import"): DocWrite {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new RuleError("signed_out", "You are signed out: sign in again, then retry.");
  return createWrite(doc(refs.auditLogs()).path, auditLineOfWrites({ uid, via, apiKeyId: null }, action, writes));
}

/**
 * Ajoute a un lot (ou une transaction) deja ouvert les ecritures d'un geste de l'Admin ET sa
 * ligne d'audit, tiree de ces memes ecritures : la ligne decrit toujours ce qui est ecrit.
 */
export function addAuditedWrites(target: WriteBatch | Transaction, action: string, writes: readonly DocWrite[], via: "ui" | "import" = "ui") {
  if (writes.length === 0) return;
  addWrites(target, [...writes, auditWrite(action, writes, via)]);
}

/**
 * Execute les ecritures d'un geste de l'Admin (shared/admin/*.ts) : les memes
 * que l'API ecrit dans sa transaction, sous le meme nom d'action (`action`), avec
 * leur ligne d'audit. Un `create` refuse un document qui existe deja
 * (`RuleError` `already_exists`) : le lot passe alors par une transaction qui le verifie.
 */
export async function commitWrites(action: string, writes: readonly DocWrite[]) {
  if (writes.length === 0) return;
  const creates = writes.filter((w) => w.op === "create");
  if (creates.length === 0) {
    const batch = writeBatch(db);
    addAuditedWrites(batch, action, writes);
    await batch.commit();
    return;
  }
  await runTransaction(db, async (tx) => {
    const existing = await Promise.all(creates.map((w) => tx.get(doc(db, w.path))));
    const taken = existing.find((snap) => snap.exists());
    if (taken) throw new RuleError("already_exists", `\`${taken.ref.path}\` already exists.`, taken.ref.path);
    addAuditedWrites(tx, action, writes);
  });
}

/** Ajoute des ecritures a un lot (ou une transaction) deja ouvert, SANS audit (fondateur, compte) : un geste de l'Admin passe par `addAuditedWrites`. */
export function addWrites(target: WriteBatch | Transaction, writes: readonly DocWrite[]) {
  // Memes methodes `set` / `delete` des deux cotes (le SDK les type separement).
  const batch = target as WriteBatch;
  for (const w of writes) {
    const ref = doc(db, w.path);
    if (w.op === "delete") batch.delete(ref);
    else if (w.op === "merge") batch.set(ref, w.data, { merge: true });
    else batch.set(ref, w.data);
  }
}

/** Un geste de l'Admin qui cree un document a id automatique, avec ses horodatages et sa ligne d'audit ; rend son id. */
export async function createDoc<T extends Timestamps>(
  action: string,
  ref: CollectionReference<WithId<T>>,
  data: Omit<T, keyof Timestamps>,
): Promise<string> {
  const now = nowISO();
  const created = doc(ref);
  await commitWrites(action, [setWrite(created.path, { ...data, createdDateISOString: now, updatedDateISOString: now })]);
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
 * `reachesShortlistDone` : cet ajout amene la shortlist a `SHORTLIST_TASK_MIN`,
 * la date de la tache shortlist du To do (`shortlistDoneDateISOString`).
 */
export async function setFounderConnection(
  ownerFounderId: string,
  list: FounderConnectionList,
  targetFounderId: string,
  on: boolean,
  reachesShortlistDone = false,
) {
  const now = nowISO();
  await setDoc(
    refs.founderConnections(ownerFounderId),
    {
      [list]: on ? arrayUnion(targetFounderId) : arrayRemove(targetFounderId),
      updatedDateISOString: now,
      ...(reachesShortlistDone ? { shortlistDoneDateISOString: now } : {}),
    } as PartialWithFieldValue<WithId<FounderConnections>>,
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
