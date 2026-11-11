"use client";

import { useMemo, type ReactNode } from "react";
import type { Startup, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";

// ----------------------------
// Niveau 2 (liste) : les startups du batch
// ----------------------------
// Monte par .../batches/[batchId]/layout.tsx. Public (nom, pitch,
// membres, statistiques).

type StartupsValue = {
  startups: WithId<Startup>[];
  /** Acces direct par id (startup d'un fondateur, d'une equipe). */
  startupsById: Map<string, WithId<Startup>>;
  isLoading: boolean;
};

const [StartupsContextProvider, useStartups] = createStrictContext<StartupsValue>("Startups");
export { useStartups };

export function StartupsProvider({ children }: { children: ReactNode }) {
  const { batch } = useBatch();
  const startups = useQueryListener(queries.startupsOfBatch(batch.id));

  const value = useMemo<StartupsValue>(() => {
    const list = [...startups.data].sort((a, b) => a.name.localeCompare(b.name));
    return { startups: list, startupsById: new Map(list.map((s) => [s.id, s])), isLoading: startups.isLoading };
  }, [startups.data, startups.isLoading]);

  return <StartupsContextProvider value={value}>{children}</StartupsContextProvider>;
}
