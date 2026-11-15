"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { FounderDirectory } from "@shared/types";
import { canReadFounderDirectory } from "@shared/access";
import { refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocsListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";

// ----------------------------
// Annuaire du batch en grille (Profile Book)
// ----------------------------
// Monte par .../founders/layout.tsx. La carte d'un fondateur reprend le
// Profile Book (track record, interets, formation, entreprises, nationalite) :
// des champs de `private/directory`, un document par fondateur, lus si le role
// y a droit. La grille est la vue par defaut (demande du 15/11), la liste reste
// au choix. Le mode vit ici et non dans la page : on revient d'une fiche sur la
// vue quittee, ecouteurs gardes. Ils s'ouvrent a la premiere visite de
// l'annuaire (la page appelle `ensureOpen`) : une fiche ouverte par un lien
// direct ne lit pas tout le batch.

export type FoundersView = "list" | "grid";

type FounderDirectoriesValue = {
  view: FoundersView;
  setView: (view: FoundersView) => void;
  /** Ouvre les ecouteurs (page Founders, a son affichage) ; ils restent ouverts ensuite. */
  ensureOpen: () => void;
  /** Par id de fondateur ; vide pour un visiteur public. */
  directoriesById: Map<string, FounderDirectory>;
  /** Vrai aussi tant que les ecouteurs ne sont pas ouverts. */
  isLoading: boolean;
};

const [FounderDirectoriesContextProvider, useFounderDirectories] =
  createStrictContext<FounderDirectoriesValue>("FounderDirectories");
export { useFounderDirectories };

export function FounderDirectoriesProvider({ children }: { children: ReactNode }) {
  const { role } = useBatch();
  const { founders } = useFounders();
  const [view, setView] = useState<FoundersView>("grid");
  const [isOpen, setIsOpen] = useState(false);
  const ensureOpen = useCallback(() => setIsOpen(true), []);

  const entries = useMemo(
    () => (isOpen && canReadFounderDirectory(role) ? founders.map((f) => [f.id, refs.founderDirectory(f.id)] as const) : null),
    [isOpen, role, founders],
  );
  const directories = useDocsListener(entries);

  const value = useMemo<FounderDirectoriesValue>(
    () => ({
      view,
      setView,
      ensureOpen,
      directoriesById: directories.data,
      isLoading: !isOpen || directories.isLoading,
    }),
    [view, ensureOpen, isOpen, directories.data, directories.isLoading],
  );

  return <FounderDirectoriesContextProvider value={value}>{children}</FounderDirectoriesContextProvider>;
}
