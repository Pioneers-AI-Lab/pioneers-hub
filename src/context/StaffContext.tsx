"use client";

import { useMemo, type ReactNode } from "react";
import type { ClaimRequest, User, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { BlockedState } from "@/components/ui/BlockedState";
import { paths } from "@/lib/paths";

// ----------------------------
// Espace staff d'un batch
// ----------------------------
// Monte par .../staff/layout.tsx. Garde du sous-arbre : seul le role `staff`
// y entre (les regles refuseraient de toute facon les lectures et ecritures).
// Lit les comptes et les demandes de rattachement du batch.

type StaffValue = {
  users: WithId<User>[];
  usersById: Map<string, WithId<User>>;
  claimRequests: WithId<ClaimRequest>[];
  isLoading: boolean;
};

const [StaffContextProvider, useStaff] = createStrictContext<StaffValue>("Staff");
export { useStaff };

export function StaffProvider({ children }: { children: ReactNode }) {
  const { program } = useProgram();
  const { batch, role } = useBatch();
  const isStaff = role === "staff";

  const users = useQueryListener(isStaff ? queries.allUsers() : null);
  const claimRequests = useQueryListener(isStaff ? queries.claimRequestsOfBatch(batch.id) : null);

  const value = useMemo<StaffValue>(
    () => ({
      users: users.data,
      usersById: new Map(users.data.map((u) => [u.id, u])),
      claimRequests: [...claimRequests.data].sort((a, b) => b.createdDateISOString.localeCompare(a.createdDateISOString)),
      isLoading: users.isLoading || claimRequests.isLoading,
    }),
    [users.data, users.isLoading, claimRequests.data, claimRequests.isLoading],
  );

  if (!isStaff) return <BlockedState reason="forbidden" backHref={paths.batch(program.id, batch.id)} />;
  return <StaffContextProvider value={value}>{children}</StaffContextProvider>;
}
