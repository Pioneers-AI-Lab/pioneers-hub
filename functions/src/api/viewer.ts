import { getFirestore } from "firebase-admin/firestore";
import { COL } from "../shared/collections";
import { roleInBatch, viewerFromUser, type BatchRole, type Viewer } from "../shared/access";
import type { BatchMembership, User } from "../shared/types";

/** Les droits d'un compte, relus dans `users/{uid}` : la meme lecture pour l'API, OAuth et les callables. */
export async function loadViewer(uid: string): Promise<Viewer> {
  const userDoc = await getFirestore().doc(`${COL.users}/${uid}`).get();
  return viewerFromUser(uid, userDoc.exists ? (userDoc.data() as User) : null);
}

/**
 * Le compte ET ses rattachements (`batchMemberships` : batch -> profil fondateur),
 * lus ensemble : c'est ce qui donne le role dans chaque batch, comme les regles
 * le font avec `isBatchMember` / `viewerFounderId`.
 */
export type Account = { viewer: Viewer; foundersByBatch: ReadonlyMap<string, string> };

export async function loadAccount(uid: string): Promise<Account> {
  const [viewer, memberships] = await Promise.all([
    loadViewer(uid),
    getFirestore().collection(COL.batchMemberships).where("uid", "==", uid).get(),
  ]);
  const foundersByBatch = new Map(
    memberships.docs.map((d) => {
      const m = d.data() as BatchMembership;
      return [m.batchId, m.founderId] as const;
    }),
  );
  return { viewer, foundersByBatch };
}

/** Le profil fondateur du compte dans ce batch, s'il en a un. */
export const founderIdIn = (account: Account, batchId: string): string | null => account.foundersByBatch.get(batchId) ?? null;

/** Le role du compte dans un batch, comme les regles le calculent. */
export const roleOf = (account: Account, batchId: string): BatchRole => roleInBatch(account.viewer, founderIdIn(account, batchId));
