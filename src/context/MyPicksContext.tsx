"use client";

import { useMemo, type ReactNode } from "react";
import type { Picks, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";

// ----------------------------
// Mes choix prives dans le batch (mutual picks, speed dating), par evenement
// ----------------------------
// Monte par todo/layout.tsx, sous MeGate (le fondateur est rattache). La regle
// `picks` ne laisse lire que les siens : la requete filtre batch et fondateur.

type MyPicksValue = { picksByEventId: Map<string, WithId<Picks>>; isLoading: boolean };

const [MyPicksContextProvider, useMyPicks] = createStrictContext<MyPicksValue>("MyPicks");
export { useMyPicks };

export function MyPicksProvider({ children }: { children: ReactNode }) {
  const { batch, viewerFounderId } = useBatch();
  const picks = useQueryListener(viewerFounderId ? queries.myPicks(batch.id, viewerFounderId) : null);
  const value = useMemo<MyPicksValue>(
    () => ({ picksByEventId: new Map(picks.data.map((p) => [p.eventId, p])), isLoading: picks.isLoading }),
    [picks.data, picks.isLoading],
  );
  return <MyPicksContextProvider value={value}>{children}</MyPicksContextProvider>;
}
