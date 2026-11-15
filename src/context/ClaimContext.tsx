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
// Monte par app/(app)/claim/layout.tsx. Lit les batchs, les demandes du
// compte (ancien parcours), et les profils non reclames du batch choisi. Le
// choix du batch est un etat d'ecran, garde ici pour que la liste suive.
// Un profil par batch : un batch ou le compte est deja rattache n'offre aucun
// profil (les regles refusent de toute facon : `founders` update, `batchMemberships` create).

type ClaimValue = {
  programsById: Map<string, WithId<Program>>;
  batches: WithId<Batch>[];
  selectedBatchId: string | null;
  selectBatch: (batchId: string | null) => void;
  /** Batchs ou le compte est deja fondateur (`batchMemberships`). */
  linkedBatchIds: Set<string>;
  unclaimedFounders: WithId<Founder>[];
  isUnclaimedLoading: boolean;
  requests: WithId<ClaimRequest>[];
  isLoading: boolean;
};

const [ClaimContextProvider, useClaim] = createStrictContext<ClaimValue>("Claim");
export { useClaim };

/**
 * Le batch montre d'office, parmi les batchs NON TERMINES : celui ou le compte
 * est deja rattache (il le retrouve), sinon le seul ou il ne l'est pas encore.
 * Jamais un batch termine, sauf s'il est seul (aucune liste a choisir) : un
 * alumni le choisit lui-meme (il reclame aussi son profil d'un batch termine).
 */
function defaultBatchId(batches: WithId<Batch>[], linkedBatchIds: Set<string>): string | null {
  const open = batches.filter((b) => b.status !== "completed");
  const linked = open.find((b) => linkedBatchIds.has(b.id));
  if (linked) return linked.id;
  const unlinked = open.filter((b) => !linkedBatchIds.has(b.id));
  if (unlinked.length === 1) return unlinked[0].id;
  return batches.length === 1 ? batches[0].id : null;
}

export function ClaimProvider({ children }: { children: ReactNode }) {
  const { firebaseUser, isLoading: isAuthLoading, memberships, isMembershipsLoading } = useAuth();
  const [chosenBatchId, selectBatch] = useState<string | null>(null);

  const programs = useQueryListener(queries.activePrograms());
  const batches = useQueryListener(queries.activeBatches());
  const requests = useQueryListener(
    isAuthLoading ? undefined : firebaseUser ? queries.myClaimRequests(firebaseUser.uid) : null,
  );
  // Batch affiche : celui choisi, sinon celui d'une demande en attente, sinon `defaultBatchId`.
  const linkedBatchIds = useMemo(() => new Set(memberships.map((m) => m.batchId)), [memberships]);
  const pendingBatchId = requests.data.find((r) => r.status === "pending")?.batchId ?? null;
  const selectedBatchId = chosenBatchId ?? pendingBatchId ?? defaultBatchId(batches.data, linkedBatchIds);
  const canClaimSelected = firebaseUser && selectedBatchId && !isMembershipsLoading && !linkedBatchIds.has(selectedBatchId);
  const unclaimed = useQueryListener(canClaimSelected ? queries.unclaimedFoundersOfBatch(selectedBatchId) : null);

  const value = useMemo<ClaimValue>(
    () => ({
      programsById: new Map(programs.data.map((p) => [p.id, p])),
      batches: [...batches.data].sort((a, b) => b.startDayString.localeCompare(a.startDayString)),
      selectedBatchId,
      selectBatch,
      linkedBatchIds,
      unclaimedFounders: unclaimed.data
        .filter((f) => f.archivedDateISOString === null)
        .sort((a, b) => a.name.localeCompare(b.name)),
      isUnclaimedLoading: unclaimed.isLoading,
      requests: requests.data,
      isLoading: programs.isLoading || batches.isLoading || requests.isLoading || isMembershipsLoading,
    }),
    [programs, batches, requests, unclaimed, selectedBatchId, linkedBatchIds, isMembershipsLoading],
  );

  return <ClaimContextProvider value={value}>{children}</ClaimContextProvider>;
}
