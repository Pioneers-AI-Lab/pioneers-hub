"use client";

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, type DocumentReference, type FirestoreError, type Query } from "firebase/firestore";

// ----------------------------
// Ecouteurs Firestore generiques
// ----------------------------
// Tout le travail Firestore d'un Provider tient dans ces deux hooks : abonnement,
// etat de chargement, erreur, desabonnement. Un Provider n'a plus qu'a dire
// QUOI ecouter.
//
// La cible a trois etats, et c'est voulu :
//   undefined  on attend une dependance (l'auth, le role)  -> isLoading: true
//   null       on n'a pas le droit de lire : on n'ecoute pas -> isLoading: false, data vide
//   une ref    on ecoute
// Sans ce troisieme etat, « pas encore » et « jamais » se confondent, et une
// page attend pour toujours un document qu'elle n'a pas le droit de lire.
//
// `isLoading` ne retombe qu'a la PREMIERE REPONSE (donnees ou erreur), jamais
// a l'enregistrement de l'ecouteur : chez Trippple, un etat calcule dans
// l'intervalle affichait une valeur que la reponse dementait aussitot.

export type Listened<T> = {
  data: T;
  isLoading: boolean;
  error: FirestoreError | null;
};

type Received<T> = { key: string; data: T; error: FirestoreError | null };

const WAITING = { isLoading: true, error: null } as const;
const SKIPPED = { isLoading: false, error: null } as const;

/** Ecoute un document. `data` vaut `null` s'il n'existe pas (ou s'il est refuse : voir `error`). */
export function useDocListener<T>(ref: DocumentReference<T> | null | undefined): Listened<T | null> {
  // La ref est recreee a chaque rendu ; son chemin est son identite.
  const key = ref == null ? ref : ref.path;
  const [received, setReceived] = useState<Received<T | null> | null>(null);

  useEffect(() => {
    if (!ref) return;
    const path = ref.path;
    return onSnapshot(
      ref,
      (snapshot) => setReceived({ key: path, data: snapshot.exists() ? snapshot.data() : null, error: null }),
      (error) => setReceived({ key: path, data: null, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on se reabonne quand le CHEMIN change, pas l'objet.
  }, [key]);

  if (key === undefined) return { data: null, ...WAITING };
  if (key === null) return { data: null, ...SKIPPED };
  if (received?.key !== key) return { data: null, ...WAITING };
  return { data: received.data, isLoading: false, error: received.error };
}

/**
 * Ecoute une requete nommee (`queries.*` de lib/firestore/refs.ts). La `key`
 * identifie la requete : un Query Firestore n'a pas de chemin comparable.
 */
export function useQueryListener<T>(named: { key: string; query: Query<T> } | null | undefined): Listened<T[]> {
  const key = named == null ? named : named.key;
  const [received, setReceived] = useState<Received<T[]> | null>(null);

  useEffect(() => {
    if (!named) return;
    const { key: currentKey, query } = named;
    return onSnapshot(
      query,
      (snapshot) => setReceived({ key: currentKey, data: snapshot.docs.map((d) => d.data()), error: null }),
      (error) => setReceived({ key: currentKey, data: [], error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on se reabonne quand la CLE change, pas l'objet.
  }, [key]);

  if (key === undefined) return { data: [], ...WAITING };
  if (key === null) return { data: [], ...SKIPPED };
  if (received?.key !== key) return { data: [], ...WAITING };
  return { data: received.data, isLoading: false, error: received.error };
}

/**
 * Ecoute plusieurs documents, chacun sous l'id que lui donne l'appelant : pour
 * une liste dont chaque element a son document prive
 * (`founders/{id}/private/directory`), qu'une requete de groupe ne lirait pas
 * (les regles relisent le parent de chaque document). `isLoading` tombe quand
 * chaque document a repondu une fois ; un document absent ou refuse manque a
 * la carte (`error` garde le premier refus). Quand la liste change, ce qui est
 * deja recu reste affiche pendant le reabonnement.
 */
export function useDocsListener<T>(
  entries: readonly (readonly [id: string, ref: DocumentReference<T>])[] | null | undefined,
): Listened<Map<string, T>> {
  // Trie : un fondateur renomme (liste reordonnee) ne reabonne pas tout.
  const key = entries == null ? entries : entries.map(([, ref]) => ref.path).sort().join("|");
  const [byId, setById] = useState<Map<string, T | null>>(() => new Map());
  const [error, setError] = useState<FirestoreError | null>(null);

  useEffect(() => {
    if (!entries) return;
    const unsubscribes = entries.map(([id, ref]) => {
      const update = (data: T | null) => setById((prev) => new Map(prev).set(id, data));
      return onSnapshot(
        ref,
        (snapshot) => update(snapshot.exists() ? snapshot.data() : null),
        (e) => {
          setError((prev) => prev ?? e);
          update(null);
        },
      );
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on se reabonne quand les CHEMINS changent, pas les objets.
  }, [key]);

  const data = useMemo(() => {
    const out = new Map<string, T>();
    entries?.forEach(([id]) => {
      const value = byId.get(id);
      if (value != null) out.set(id, value);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` resume `entries`.
  }, [byId, key]);

  if (key === undefined) return { data, ...WAITING };
  if (key === null) return { data, ...SKIPPED };
  return { data, isLoading: entries!.some(([id]) => !byId.has(id)), error };
}
