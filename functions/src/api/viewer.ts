import { getFirestore } from "firebase-admin/firestore";
import { COL } from "../shared/collections";
import { viewerFromUser, type Viewer } from "../shared/access";
import type { User } from "../shared/types";

/** Les droits d'un compte, relus dans `users/{uid}` : la meme lecture pour l'API, OAuth et les callables. */
export async function loadViewer(uid: string): Promise<Viewer> {
  const userDoc = await getFirestore().doc(`${COL.users}/${uid}`).get();
  return viewerFromUser(uid, userDoc.exists ? (userDoc.data() as User) : null);
}
