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
// des champs de `private/directory`, un document par fondateur. On ne les lit
// qu'en mode grille, et seulement si le role y a droit. Le mode vit ici et non
// dans la page : on revient d'une fiche sur la grille, ecouteurs gardes. Une
// fois la grille ouverte, ils restent ouverts (repasser par la liste ne relit
// pas tout l'annuaire).

export type FoundersView = "list" | "grid";

type FounderDirectoriesValue = {
  view: FoundersView;
  setView: (view: FoundersView) => void;
  /** Par id de fondateur ; vide en mode liste ou pour un visiteur public. */
  directoriesById: Map<string, FounderDirectory>;
  isLoading: boolean;
};

const [FounderDirectoriesContextProvider, useFounderDirectories] =
  createStrictContext<FounderDirectoriesValue>("FounderDirectories");
export { useFounderDirectories };

export function FounderDirectoriesProvider({ children }: { children: ReactNode }) {
  const { role } = useBatch();
  const { founders } = useFounders();
  const [view, setViewState] = useState<FoundersView>("list");
  const [hasOpenedGrid, setHasOpenedGrid] = useState(false);
  const setView = useCallback((next: FoundersView) => {
    setViewState(next);
    if (next === "grid") setHasOpenedGrid(true);
  }, []);

  const entries = useMemo(
    () =>
      hasOpenedGrid && canReadFounderDirectory(role)
        ? founders.map((f) => [f.id, refs.founderDirectory(f.id)] as const)
        : null,
    [hasOpenedGrid, role, founders],
  );
  const directories = useDocsListener(entries);

  const value = useMemo<FounderDirectoriesValue>(
    () => ({ view, setView, directoriesById: directories.data, isLoading: directories.isLoading }),
    [view, setView, directories.data, directories.isLoading],
  );

  return <FounderDirectoriesContextProvider value={value}>{children}</FounderDirectoriesContextProvider>;
}
