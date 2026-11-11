"use client";

import { useMemo, type ReactNode } from "react";
import type { Founder, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";

// ----------------------------
// Niveau 2 (liste) : les fondateurs du batch
// ----------------------------
// Monte par .../batches/[batchId]/layout.tsx : l'ecouteur survit a toute
// navigation dans le batch. La requete depend du role : un
// visiteur public ne liste que les profils consentants (voir queries).

type FoundersValue = {
  founders: WithId<Founder>[];
  /** Acces direct par id, pour resoudre les membres d'une startup ou d'une equipe. */
  foundersById: Map<string, WithId<Founder>>;
  isLoading: boolean;
};

const [FoundersContextProvider, useFounders] = createStrictContext<FoundersValue>("Founders");
export { useFounders };

export function FoundersProvider({ children }: { children: ReactNode }) {
  const { batch, role } = useBatch();
  const founders = useQueryListener(queries.foundersOfBatch(batch.id, role === "public" ? "public" : "batch"));

  const value = useMemo<FoundersValue>(() => {
    const list = founders.data
      .filter((f) => f.archivedDateISOString === null)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { founders: list, foundersById: new Map(list.map((f) => [f.id, f])), isLoading: founders.isLoading };
  }, [founders.data, founders.isLoading]);

  return <FoundersContextProvider value={value}>{children}</FoundersContextProvider>;
}
