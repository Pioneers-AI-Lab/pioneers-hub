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

type LeaderboardsValue = {
  leaderboardsByEventId: Map<string, WithId<Leaderboard>>;
  isHidden: boolean;
  isLoading: boolean;
};

const [LeaderboardsContextProvider, useLeaderboards] = createStrictContext<LeaderboardsValue>("Leaderboards");
export { useLeaderboards };

export function LeaderboardsProvider({ children }: { children: ReactNode }) {
  const { batch, role } = useBatch();
  const isHidden = batch.settings.leaderboardVisibility === "hidden" && !isStaffOrInvestor(role);
  const leaderboards = useQueryListener(isHidden ? null : queries.leaderboardsOfBatch(batch.id));

  const value = useMemo<LeaderboardsValue>(
    () => ({
      leaderboardsByEventId: new Map(leaderboards.data.map((l) => [l.eventId, l])),
      isHidden,
      isLoading: leaderboards.isLoading,
    }),
    [leaderboards.data, leaderboards.isLoading, isHidden],
  );

  return <LeaderboardsContextProvider value={value}>{children}</LeaderboardsContextProvider>;
}
