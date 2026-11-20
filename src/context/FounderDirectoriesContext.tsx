"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { FounderDirectory, WithId } from "@shared/types";
import { canReadFounderDirectory } from "@shared/access";
import { refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocsListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";

// ----------------------------
// Annuaire du batch en grille (Profile Book)
// ----------------------------
// Monte par .../batches/[batchId]/layout.tsx (sous FoundersProvider) : la fiche
// d'un fondateur, « Me » compris, s'en amorce (FounderContext), et l'aller-retour
// par Startups ou Calendar ne relit pas l'annuaire. La carte d'un fondateur reprend le
// Profile Book (formation, entreprises, nationalite ; le one-liner vient de la
// fiche racine) : des champs de `private/directory`, un document par fondateur, lus si le role
// y a droit. La grille est la vue par defaut (demande du 15/11), la liste reste
// au choix. Vue, filtres, tri et recherche vivent dans l'URL (demande du
// 16/11, hooks/useUrlState.ts) ; ce contexte garde la derniere (`query`, notee
// en quittant la page) pour que « All founders » d'une fiche ramene a la vue
// quittee, ecouteurs gardes. Ils s'ouvrent a la premiere visite de
// l'annuaire (la page appelle `ensureOpen`) : une fiche ouverte par un lien
// direct ne lit pas tout le batch.

type FounderDirectoriesValue = {
  /** Derniere query de la page Founders (`view=list&q=...`, sans `?`) ; vide avant la premiere visite. */
  query: string;
  rememberQuery: (query: string) => void;
  /** Ouvre les ecouteurs (page Founders, a son affichage) ; ils restent ouverts ensuite. */
  ensureOpen: () => void;
  /** Par id de fondateur ; vide pour un visiteur public. Amorce aussi la fiche (FounderContext). */
  directoriesById: Map<string, WithId<FounderDirectory>>;
  /** Vrai aussi tant que les ecouteurs ne sont pas ouverts. */
  isLoading: boolean;
};

const [FounderDirectoriesContextProvider, useFounderDirectories] =
  createStrictContext<FounderDirectoriesValue>("FounderDirectories");
export { useFounderDirectories };

export function FounderDirectoriesProvider({ children }: { children: ReactNode }) {
  const { role } = useBatch();
  const { founders } = useFounders();
  const [query, rememberQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const ensureOpen = useCallback(() => setIsOpen(true), []);

  const entries = useMemo(
    () => (isOpen && canReadFounderDirectory(role) ? founders.map((f) => [f.id, refs.founderDirectory(f.id)] as const) : null),
    [isOpen, role, founders],
  );
  const directories = useDocsListener(entries);

  const value = useMemo<FounderDirectoriesValue>(
    () => ({
      query,
      rememberQuery,
      ensureOpen,
      directoriesById: directories.data,
      isLoading: !isOpen || directories.isLoading,
    }),
    [query, ensureOpen, isOpen, directories.data, directories.isLoading],
  );

  return <FounderDirectoriesContextProvider value={value}>{children}</FounderDirectoriesContextProvider>;
}
