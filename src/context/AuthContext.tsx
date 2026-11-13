"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User as FirebaseUser } from "firebase/auth";
import { getDoc, setDoc } from "firebase/firestore";
import { viewerFromUser, type Viewer } from "@shared/access";
import type { BatchMembership, User, WithId } from "@shared/types";
import { auth, googleProvider } from "@/lib/firebase";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { paths } from "@/lib/paths";
import { useDocListener, useQueryListener } from "@/hooks/useFirestoreListener";

// ----------------------------
// Niveau 0 : le visiteur
// ----------------------------
// Monte a la racine (app/providers.tsx). Ne bloque RIEN : un visiteur non
// connecte est un visiteur `public`, et les pages publiques s'affichent pour
// lui. Ce sont les niveaux en dessous qui decident de ce qu'il peut lire.

type AuthValue = {
  firebaseUser: FirebaseUser | null;
  user: WithId<User> | null;
  /** Ce que lisent les regles d'acces (`roleInBatch`). `null` = non connecte. */
  viewer: Viewer | null;
  /** Vrai tant que l'on ne sait pas encore QUI est le visiteur. */
  isLoading: boolean;
  /** Les batchs dont le compte est fondateur (vide si non connecte). */
  memberships: WithId<BatchMembership>[];
  isMembershipsLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  /**
   * Deconnecte, puis renvoie vers la page de connexion (ou `redirectTo`,
   * ex. la page de connexion avec un retour vers le consentement OAuth).
   */
  signOut: (redirectTo?: string) => Promise<void>;
  /**
   * Vrai apres « Sign out », jusqu'a la connexion suivante : la page quittee ne
   * devient pas le retour (`?next=`) du compte suivant (BlockedState).
   */
  hasSignedOut: boolean;
  /**
   * Relit le compte et son jeton (apres la confirmation de l'email, faite dans
   * un autre onglet) : `emailVerified` et le jeton lu par les regles a jour.
   */
  reloadUser: () => Promise<void>;
};

const [AuthContextProvider, useAuth] = createStrictContext<AuthValue>("Auth");
export { useAuth };

/** Cree `users/{uid}` a la premiere connexion, puis note la derniere visite. */
async function upsertUserDoc(firebaseUser: FirebaseUser) {
  const ref = refs.user(firebaseUser.uid);
  const now = new Date().toISOString();
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) {
    await setDoc(ref, { lastSeenDateISOString: now }, { merge: true });
    return;
  }
  // Aucun role a la creation (impose par les regles) : seul le staff ou le SDK
  // admin accorde ensuite `staff`, `investor` ou `mentor`.
  // Le compteur de connexions est incremente par le serveur, pas ici.
  // `id` est exige par le type mais retire par le convertisseur : il n'est pas stocke.
  await setDoc(ref, {
    id: firebaseUser.uid,
    personId: null,
    roles: [],
    investorAccess: null,
    loginCount: 0,
    createdDateISOString: now,
    lastSeenDateISOString: now,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // `undefined` tant que Firebase Auth n'a pas repondu.
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null | undefined>(undefined);
  // `reload()` modifie le compte EN PLACE : sans ce compteur, React ne verrait rien.
  const [userVersion, setUserVersion] = useState(0);
  const [hasSignedOut, setHasSignedOut] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(auth, (nextUser) => {
        setFirebaseUser(nextUser);
        if (nextUser) {
          setHasSignedOut(false);
          upsertUserDoc(nextUser).catch((err) => console.error("users/{uid} upsert failed", err));
        }
      }),
    [],
  );

  const userDoc = useDocListener(
    firebaseUser === undefined ? undefined : firebaseUser === null ? null : refs.user(firebaseUser.uid),
  );

  const memberships = useQueryListener(
    firebaseUser === undefined ? undefined : firebaseUser === null ? null : queries.myMemberships(firebaseUser.uid),
  );

  // Le visiteur ne change que si ses DROITS changent (pas a chaque ecriture de
  // `lastSeen`) : sinon tout l'arbre du batch se re-rendrait pour rien.
  const uid = firebaseUser?.uid ?? null;
  const roles = userDoc.data?.roles.join(",") ?? "";
  const investorAccess = userDoc.data?.investorAccess ?? null;
  const viewer = useMemo<Viewer | null>(
    () =>
      uid ? viewerFromUser(uid, { roles: roles ? (roles.split(",") as Viewer["roles"]) : [], investorAccess }) : null,
    [uid, roles, investorAccess],
  );

  const value = useMemo<AuthValue>(() => {
    return {
      firebaseUser: firebaseUser ?? null,
      user: userDoc.data,
      viewer,
      isLoading: firebaseUser === undefined || userDoc.isLoading,
      memberships: memberships.data,
      isMembershipsLoading: memberships.isLoading,
      signInWithGoogle: async () => {
        await signInWithPopup(auth, googleProvider);
      },
      signOut: async (redirectTo = paths.signIn()) => {
        // Avant la deconnexion : la page courante, refusee a l'instant, ne doit pas renvoyer vers elle-meme.
        setHasSignedOut(true);
        await firebaseSignOut(auth);
        router.replace(redirectTo);
      },
      reloadUser: async () => {
        if (!auth.currentUser) return;
        await auth.currentUser.reload();
        await auth.currentUser.getIdToken(true);
        setUserVersion((v) => v + 1);
      },
      hasSignedOut,
    };
    // `userVersion` : le meme objet compte, relu (voir plus haut).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, userDoc.data, userDoc.isLoading, viewer, memberships.data, memberships.isLoading, userVersion, hasSignedOut, router]);

  return <AuthContextProvider value={value}>{children}</AuthContextProvider>;
}
