"use client";

import type { ReactNode } from "react";
import { FormsToFillProvider } from "@/context/FormsToFillContext";

/**
 * Ce que lit `useTodoItems` sous le fondateur affiche (formulaires a remplir),
 * sous MeGate ou sur SA fiche : monte par (mine)/layout.tsx et `SelfProviders`.
 * Une source du To do qui depend du fondateur s'ajoute ICI, une fois ; les
 * taches et mes coches (TasksContext) sont au layout du batch.
 */
export function TodoProviders({ children }: { children: ReactNode }) {
  return <FormsToFillProvider>{children}</FormsToFillProvider>;
}
