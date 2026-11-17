"use client";

import { useMemo, type ReactNode } from "react";
import { isStaffOrInvestor } from "@shared/access";
import type { Leaderboard, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";

// ----------------------------
// Leaderboards du batch (agregats publics, ecrits par Cloud Functions)
// ----------------------------
// Masques pendant les mutual picks : la REGLE refuse la lecture, sauf au staff
// et aux investors. On n'ouvre donc pas l'ecouteur quand ils sont masques.
// Un classement a bareme n'est montre aux fondateurs qu'une fois publie par le
// staff, une fois le jury passe (SPECS §4.2).
//
// Pas de classement individuel sur l'ensemble des hackathons (decision du 17/11) :
// la moyenne des notes d'un fondateur ne sert qu'au sous-score Execution.

type LeaderboardsValue = {
  leaderboardsByEventId: Map<string, WithId<Leaderboard>>;
  isHidden: boolean;
  isLoading: boolean;
};

const [LeaderboardsContextProvider, useLeaderboards] = createStrictContext<LeaderboardsValue>("Leaderboards");
export { useLeaderboards };

export function LeaderboardsProvider({ children }: { children: ReactNode }) {
  const { batch, role } = useBatch();
  const insider = isStaffOrInvestor(role);
  const isHidden = batch.settings.leaderboardVisibility === "hidden" && !insider;
  const leaderboards = useQueryListener(isHidden ? null : queries.leaderboardsOfBatch(batch.id));

  const value = useMemo<LeaderboardsValue>(() => {
    const shown = leaderboards.data.filter((l) => insider || l.published !== false);
    return {
      leaderboardsByEventId: new Map(shown.map((l) => [l.eventId, l])),
      isHidden,
      isLoading: leaderboards.isLoading,
    };
  }, [leaderboards.data, leaderboards.isLoading, isHidden, insider]);

  return <LeaderboardsContextProvider value={value}>{children}</LeaderboardsContextProvider>;
}
