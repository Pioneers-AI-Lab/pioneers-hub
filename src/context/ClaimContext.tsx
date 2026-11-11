"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Batch, ClaimRequest, Founder, Program, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useAuth } from "@/context/AuthContext";

// ----------------------------
// Rattachement du compte (page /claim)
// ----------------------------
// Monte par app/(app)/claim/layout.tsx. Lit les batchs ouverts, les demandes
// du compte, et les profils non reclames du batch choisi. Le choix du batch
// est un etat d'ecran, garde ici pour que la liste suive.

type ClaimValue = {
  programsById: Map<string, WithId<Program>>;
  batches: WithId<Batch>[];
  selectedBatchId: string | null;
  selectBatch: (batchId: string | null) => void;
  unclaimedFounders: WithId<Founder>[];
  isUnclaimedLoading: boolean;
  requests: WithId<ClaimRequest>[];
  isLoading: boolean;
};

const [ClaimContextProvider, useClaim] = createStrictContext<ClaimValue>("Claim");
export { useClaim };

export function ClaimProvider({ children }: { children: ReactNode }) {
  const { firebaseUser, isLoading: isAuthLoading } = useAuth();
  const [chosenBatchId, selectBatch] = useState<string | null>(null);

  const programs = useQueryListener(queries.activePrograms());
  const batches = useQueryListener(queries.activeBatches());
  const requests = useQueryListener(
    isAuthLoading ? undefined : firebaseUser ? queries.myClaimRequests(firebaseUser.uid) : null,
  );
  // Batch affiche : celui choisi, sinon celui d'une demande en attente, sinon le seul ouvert.
  const openBatches = useMemo(() => batches.data.filter((b) => b.status !== "completed"), [batches.data]);
  const pendingBatchId = requests.data.find((r) => r.status === "pending")?.batchId ?? null;
  const selectedBatchId = chosenBatchId ?? pendingBatchId ?? (openBatches.length === 1 ? openBatches[0].id : null);
  const unclaimed = useQueryListener(
    firebaseUser && selectedBatchId ? queries.unclaimedFoundersOfBatch(selectedBatchId) : null,
  );

  const value = useMemo<ClaimValue>(
    () => ({
      programsById: new Map(programs.data.map((p) => [p.id, p])),
      batches: [...openBatches].sort((a, b) => b.startDayString.localeCompare(a.startDayString)),
      selectedBatchId,
      selectBatch,
      unclaimedFounders: unclaimed.data
        .filter((f) => f.archivedDateISOString === null)
        .sort((a, b) => a.name.localeCompare(b.name)),
      isUnclaimedLoading: unclaimed.isLoading,
      requests: requests.data,
      isLoading: programs.isLoading || batches.isLoading || requests.isLoading,
    }),
    [programs, batches, requests, unclaimed, selectedBatchId, openBatches],
  );

  return <ClaimContextProvider value={value}>{children}</ClaimContextProvider>;
}
