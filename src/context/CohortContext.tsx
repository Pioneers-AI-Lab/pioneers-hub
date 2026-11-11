"use client";

import { useMemo, type ReactNode } from "react";
import { isStaffOrInvestor } from "@shared/access";
import type { BatchStats, FounderScore, StartupScore, WithId } from "@shared/types";
import { programPerformance, startupScore } from "@shared/types";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener, useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";

// ----------------------------
// Niveau 2 : la cohorte (statistiques et scores du batch)
// ----------------------------
// Ce que montrait le dashboard Spring 2026 : la vue d'ensemble (publique,
// `batchStats`) et les scores (staff et investors, `scores`). Monte au layout
// du batch : l'accueil, les listes et les fiches s'en servent.
// Les PONDERATIONS s'appliquent ici, a la lecture (SPECS §5).

type CohortValue = {
  stats: WithId<BatchStats> | null;
  /** Vrai si le role lit les scores (staff, investors). */
  canSeeScores: boolean;
  founderScores: Map<string, WithId<FounderScore>>;
  startupScores: Map<string, WithId<StartupScore>>;
  /** Program Performance d'un fondateur, sur 10 (`null` sans donnee). */
  founderPerformance: (founderId: string) => number | null;
  /** Score d'une startup sur 10 (`null` sans donnee). */
  startupScoreOf: (startupId: string) => number | null;
  isLoading: boolean;
};

const [CohortContextProvider, useCohort] = createStrictContext<CohortValue>("Cohort");
export { useCohort };

export function CohortProvider({ children }: { children: ReactNode }) {
  const { batch, role } = useBatch();
  const canSeeScores = isStaffOrInvestor(role);
  const stats = useDocListener(refs.batchStats(batch.id));
  const scores = useQueryListener(canSeeScores ? queries.scoresOfBatch(batch.id) : null);

  const value = useMemo<CohortValue>(() => {
    const founderScores = new Map<string, WithId<FounderScore>>();
    const startupScores = new Map<string, WithId<StartupScore>>();
    const startupScoreById = new Map<string, number | null>();
    for (const s of scores.data) {
      if (s.targetType === "founder") founderScores.set(s.targetId, s);
      else {
        startupScores.set(s.targetId, s);
        startupScoreById.set(s.targetId, startupScore(s.subScores));
      }
    }
    return {
      stats: stats.data,
      canSeeScores,
      founderScores,
      startupScores,
      founderPerformance: (id) => {
        const s = founderScores.get(id);
        return s ? programPerformance(s.subScores) : null;
      },
      startupScoreOf: (id) => startupScoreById.get(id) ?? null,
      isLoading: stats.isLoading || scores.isLoading,
    };
  }, [stats.data, stats.isLoading, scores.data, scores.isLoading, canSeeScores]);

  return <CohortContextProvider value={value}>{children}</CohortContextProvider>;
}
