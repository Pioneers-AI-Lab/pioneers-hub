"use client";

import { useMemo, type ReactNode } from "react";
import type { PioneersEvent, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";

// ----------------------------
// Niveau 2 : les evenements du batch
// ----------------------------
// Monte au layout du batch : l'accueil (a venir), « To do », les equipes et
// le leaderboard en ont tous besoin. Les evenements sont publics.

type EventsValue = {
  /** Non archives, par date de debut. */
  events: WithId<PioneersEvent>[];
  eventsById: Map<string, WithId<PioneersEvent>>;
  isLoading: boolean;
};

const [EventsContextProvider, useEvents] = createStrictContext<EventsValue>("Events");
export { useEvents };

export function EventsProvider({ children }: { children: ReactNode }) {
  const { batch } = useBatch();
  const events = useQueryListener(queries.eventsOfBatch(batch.id));

  const value = useMemo<EventsValue>(() => {
    const list = events.data
      .filter((e) => e.archivedDateISOString === null && e.status !== "draft")
      .sort((a, b) => a.startDateISOString.localeCompare(b.startDateISOString));
    return { events: list, eventsById: new Map(list.map((e) => [e.id, e])), isLoading: events.isLoading };
  }, [events.data, events.isLoading]);

  return <EventsContextProvider value={value}>{children}</EventsContextProvider>;
}
