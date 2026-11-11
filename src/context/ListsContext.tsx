"use client";

import { useMemo, type ReactNode } from "react";
import type { ClosedList, ListKey, WithId } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener } from "@/hooks/useFirestoreListener";

// ----------------------------
// Listes fermees (lists/*), publiques
// ----------------------------
// Les valeurs proposees dans « Mon profil » et l'import. Montees au layout du
// batch (les deux consommateurs y sont).

type ListsValue = {
  /** Valeurs non archivees d'une liste ; vide si la liste n'existe pas. */
  values: (key: ListKey) => string[];
  labelOf: (key: ListKey, value: string) => string;
  isLoading: boolean;
};

const [ListsContextProvider, useLists] = createStrictContext<ListsValue>("Lists");
export { useLists };

export function ListsProvider({ children }: { children: ReactNode }) {
  const hardSkills = useDocListener(refs.list("hardSkills"));
  const industries = useDocListener(refs.list("industries"));
  const positionFit = useDocListener(refs.list("positionFit"));
  const degrees = useDocListener(refs.list("degrees"));

  const value = useMemo<ListsValue>(() => {
    const byKey = new Map<ListKey, WithId<ClosedList> | null>([
      ["hardSkills", hardSkills.data],
      ["industries", industries.data],
      ["positionFit", positionFit.data],
      ["degrees", degrees.data],
    ]);
    return {
      values: (key) => (byKey.get(key)?.items ?? []).filter((i) => !i.archived).map((i) => i.value),
      labelOf: (key, v) => byKey.get(key)?.items.find((i) => i.value === v)?.label ?? v,
      isLoading: hardSkills.isLoading || industries.isLoading || positionFit.isLoading || degrees.isLoading,
    };
  }, [hardSkills, industries, positionFit, degrees]);

  return <ListsContextProvider value={value}>{children}</ListsContextProvider>;
}
