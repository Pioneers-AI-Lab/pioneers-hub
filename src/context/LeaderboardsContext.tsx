"use client";

import { useMemo, type ReactNode } from "react";
import { isStaffOrInvestor } from "@shared/access";
import { countsAcrossHackathons } from "@shared/scoringRules";
import { roundTo, type Leaderboard, type WithId } from "@shared/types";
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
// staff, apres la verification des preuves (SPECS §4.2).
//
// Le classement fondateur cumule (SPECS §4.2) se lit des classements a bareme
// publies : chaque membre recoit le score normalise de son equipe (meilleure
// equipe = 100), et le cumul est la somme de ses hackathons.

/** Le classement cumule d'un fondateur. */
export type CumulativeRow = { founderId: string; total: number; events: number; rank: number };

type LeaderboardsValue = {
  leaderboardsByEventId: Map<string, WithId<Leaderboard>>;
  /** Fondateurs classes par la somme de leurs scores normalises (classements a bareme publies). */
  cumulative: CumulativeRow[];
  isHidden: boolean;
  isLoading: boolean;
};

function cumulativeOf(boards: readonly Leaderboard[]): CumulativeRow[] {
  const totals = new Map<string, { total: number; events: number }>();
  for (const board of boards) {
    if (!countsAcrossHackathons(board)) continue;
    for (const row of board.rows) {
      for (const id of row.memberIds) {
        const t = totals.get(id) ?? { total: 0, events: 0 };
        t.total += row.normalized ?? 0;
        t.events += 1;
        totals.set(id, t);
      }
    }
  }
  const sorted = [...totals].map(([founderId, t]) => ({ founderId, total: roundTo(t.total, 1), events: t.events })).sort((a, b) => b.total - a.total);
  // Ex aequo : meme rang (classement « 1, 2, 2, 4 »).
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || sorted[i - 1].total !== r.total) rank = i + 1;
    return { ...r, rank };
  });
}

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
      cumulative: cumulativeOf(shown),
      isHidden,
      isLoading: leaderboards.isLoading,
    };
  }, [leaderboards.data, leaderboards.isLoading, isHidden, insider]);

  return <LeaderboardsContextProvider value={value}>{children}</LeaderboardsContextProvider>;
}
