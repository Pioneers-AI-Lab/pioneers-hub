"use client";

import { useMemo, type ReactNode } from "react";
import { readConnections } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";

// ----------------------------
// Ma shortlist et mes rencontres (le VISITEUR fondateur du batch)
// ----------------------------
// Monte par le layout du batch : la liste et la grille (filtre, indicateur), les
// fiches (boutons « Shortlist » / « Met ») et SA fiche (sections Shortlist / Met,
// FounderConnections) la lisent, l'ecouteur survit aux navigations. Cible `null`
// si le visiteur n'est pas fondateur du batch (aucun rattachement) : rien a lire
// ni a ecrire. Les listes d'un AUTRE fondateur affiche sont dans FounderContext.

type MyConnectionsValue = {
  /** Profil du visiteur dans ce batch ; `null` s'il n'en est pas fondateur. */
  founderId: string | null;
  shortlisted: ReadonlySet<string>;
  met: ReadonlySet<string>;
  isLoading: boolean;
};

const [MyConnectionsContextProvider, useMyConnections] = createStrictContext<MyConnectionsValue>("MyConnections");
export { useMyConnections };

export function MyConnectionsProvider({ children }: { children: ReactNode }) {
  const { viewerFounderId } = useBatch();
  const doc = useDocListener(viewerFounderId ? refs.founderConnections(viewerFounderId) : null);

  const value = useMemo<MyConnectionsValue>(
    () => {
      const { shortlistedFounderIds, metFounderIds } = readConnections(doc.data);
      return { founderId: viewerFounderId, shortlisted: new Set(shortlistedFounderIds), met: new Set(metFounderIds), isLoading: doc.isLoading };
    },
    [viewerFounderId, doc.data, doc.isLoading],
  );

  return <MyConnectionsContextProvider value={value}>{children}</MyConnectionsContextProvider>;
}
