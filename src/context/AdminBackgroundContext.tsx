"use client";

import { useMemo, type ReactNode } from "react";
import { isBatchParticipant, type Founder, type FounderBackground, type FounderDirectory, type FounderEdgeRating, type WithId } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocsListener } from "@/hooks/useFirestoreListener";
import { useAdmin } from "@/context/AdminContext";

// ----------------------------
// Admin > Background et Admin > Edge : les notes du staff sur les fondateurs du batch de travail
// ----------------------------
// Monte par admin/background/layout.tsx et admin/edge/layout.tsx. Pour chaque participant du
// batch : son annuaire (`private/directory`, les faits du profil et son Edge) et ses notes
// (`private/internal.background` et `.edge`, staff + IC), un document par fondateur.

export type BackgroundRow = {
  founder: WithId<Founder>;
  directory: FounderDirectory | null;
  background: FounderBackground | null;
  edge: FounderEdgeRating | null;
};

type AdminBackgroundValue = {
  /** Participants du batch, par nom. */
  rows: BackgroundRow[];
  rowOf: (founderId: string) => BackgroundRow | null;
  isLoading: boolean;
};

const [AdminBackgroundContextProvider, useAdminBackground] = createStrictContext<AdminBackgroundValue>("AdminBackground");
export { useAdminBackground };

export function AdminBackgroundProvider({ children }: { children: ReactNode }) {
  const { batch, founders, isLoading: isAdminLoading } = useAdmin();
  const participants = useMemo(() => founders.filter((f) => isBatchParticipant(f, batch.id)), [founders, batch.id]);
  const directories = useDocsListener(useMemo(() => participants.map((f) => [f.id, refs.founderDirectory(f.id)] as const), [participants]));
  const internals = useDocsListener(useMemo(() => participants.map((f) => [f.id, refs.founderInternal(f.id)] as const), [participants]));

  const value = useMemo<AdminBackgroundValue>(() => {
    const rows = participants.map((founder) => ({
      founder,
      directory: directories.data.get(founder.id) ?? null,
      background: internals.data.get(founder.id)?.background ?? null,
      edge: internals.data.get(founder.id)?.edge ?? null,
    }));
    const byId = new Map(rows.map((r) => [r.founder.id, r]));
    return {
      rows,
      rowOf: (id) => byId.get(id) ?? null,
      isLoading: isAdminLoading || directories.isLoading || internals.isLoading,
    };
  }, [participants, directories.data, directories.isLoading, internals.data, internals.isLoading, isAdminLoading]);

  return <AdminBackgroundContextProvider value={value}>{children}</AdminBackgroundContextProvider>;
}
