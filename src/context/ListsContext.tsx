"use client";

import { useMemo, type ReactNode } from "react";
import type { ClosedList, ListKey, TagColor, WithId } from "@shared/types";
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
  /** Couleur d'etiquette de la valeur (`null` : pas de couleur enregistree). */
  colorOf: (key: ListKey, value: string) => TagColor | null;
  isLoading: boolean;
};

const [ListsContextProvider, useLists] = createStrictContext<ListsValue>("Lists");
export { useLists };

export function ListsProvider({ children }: { children: ReactNode }) {
  const hardSkills = useDocListener(refs.list("hardSkills"));
  const industries = useDocListener(refs.list("industries"));
  const positionFit = useDocListener(refs.list("positionFit"));
  const degrees = useDocListener(refs.list("degrees"));
  const programWeeks = useDocListener(refs.list("programWeeks"));

  const value = useMemo<ListsValue>(() => {
    const byKey = new Map<ListKey, WithId<ClosedList> | null>([
      ["hardSkills", hardSkills.data],
      ["industries", industries.data],
      ["positionFit", positionFit.data],
      ["degrees", degrees.data],
      ["programWeeks", programWeeks.data],
    ]);
    const itemOf = (key: ListKey, v: string) => byKey.get(key)?.items.find((i) => i.value === v);
    return {
      values: (key) => (byKey.get(key)?.items ?? []).filter((i) => !i.archived).map((i) => i.value),
      labelOf: (key, v) => itemOf(key, v)?.label ?? v,
      colorOf: (key, v) => itemOf(key, v)?.color ?? null,
      isLoading: hardSkills.isLoading || industries.isLoading || positionFit.isLoading || degrees.isLoading || programWeeks.isLoading,
    };
    // Les donnees, pas les objets d'ecoute (recrees a chaque rendu) : la valeur ne
    // change qu'a l'arrivee d'une liste, et les etiquettes ne se redessinent pas pour rien.
  }, [
    hardSkills.data,
    industries.data,
    positionFit.data,
    degrees.data,
    programWeeks.data,
    hardSkills.isLoading,
    industries.isLoading,
    positionFit.isLoading,
    degrees.isLoading,
    programWeeks.isLoading,
  ]);

  return <ListsContextProvider value={value}>{children}</ListsContextProvider>;
}
