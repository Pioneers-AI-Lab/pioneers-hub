"use client";

import { useMemo, type ReactNode } from "react";
import { groupTeamLocks, type TeamLockGroups } from "@shared/teamLocks";
import { isBatchParticipant, type Founder, type WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useAdmin } from "@/context/AdminContext";

// ----------------------------
// Admin > Startups : les reponses a Lock my team du batch de travail
// ----------------------------
// Monte par admin/startups/layout.tsx. Les reponses (`teamLocks`, staff + IC) sont
// rangees par `groupTeamLocks` (shared/teamLocks.ts) : equipes reciproques proposees,
// reponses a verifier, « non ». Un fondateur deja dans une startup n'est plus range.
// Attendus : les participants du batch, comme le formulaire (rattache au batch).

type AdminTeamLocksValue = {
  groups: TeamLockGroups;
  /** Participants sans startup qui ont repondu, et ceux qui n'ont pas encore repondu, par nom. */
  answered: WithId<Founder>[];
  notAnswered: WithId<Founder>[];
  /** Participants sans startup, par nom : ceux que le staff peut mettre dans une startup. */
  available: WithId<Founder>[];
  isLoading: boolean;
};

const [AdminTeamLocksContextProvider, useAdminTeamLocks] = createStrictContext<AdminTeamLocksValue>("AdminTeamLocks");
export { useAdminTeamLocks };

export function AdminTeamLocksProvider({ children }: { children: ReactNode }) {
  const { batch, founders, isLoading: isAdminLoading } = useAdmin();
  const locks = useQueryListener(queries.teamLocksOfBatch(batch.id));

  const value = useMemo<AdminTeamLocksValue>(() => {
    const participants = founders.filter((f) => isBatchParticipant(f, batch.id));
    const assigned = new Set(founders.filter((f) => f.startupId).map((f) => f.id));
    const answeredIds = new Set(locks.data.filter((l) => l.locked !== null).map((l) => l.founderId));
    const available = participants.filter((f) => !f.startupId);
    return {
      groups: groupTeamLocks(locks.data, assigned),
      answered: available.filter((f) => answeredIds.has(f.id)),
      notAnswered: available.filter((f) => !answeredIds.has(f.id)),
      available,
      isLoading: isAdminLoading || locks.isLoading,
    };
  }, [batch.id, founders, locks.data, locks.isLoading, isAdminLoading]);

  return <AdminTeamLocksContextProvider value={value}>{children}</AdminTeamLocksContextProvider>;
}
