"use client";

import { useMemo, type ReactNode } from "react";
import { canSeeEvent } from "@shared/access";
import { isPublishedEvent } from "@shared/events";
import type { PioneersEvent, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";

// ----------------------------
// Niveau 2 : les evenements du batch
// ----------------------------
// Monte au layout du batch : l'accueil (a venir), « To do », les equipes et
// le leaderboard en ont tous besoin. Les evenements sont publics ; ceux a
// audience restreinte (office hours...) ne s'affichent qu'a leurs invites
// (`canSeeEvent`, shared/access.ts), au staff et aux investors.

type EventsValue = {
  /** Publies (ni brouillon ni archive) et destines au visiteur, par date de debut. */
  events: WithId<PioneersEvent>[];
  eventsById: Map<string, WithId<PioneersEvent>>;
  /** Tous ceux du batch, brouillons et audiences restreintes compris : ce qui decide de l'audience d'un formulaire. */
  allEventsById: Map<string, WithId<PioneersEvent>>;
  isLoading: boolean;
};

const [EventsContextProvider, useEvents] = createStrictContext<EventsValue>("Events");
export { useEvents };

export function EventsProvider({ children }: { children: ReactNode }) {
  const { batch, role, viewerFounderId } = useBatch();
  const { foundersById } = useFounders();
  const events = useQueryListener(queries.eventsOfBatch(batch.id));
  const startupId = viewerFounderId ? (foundersById.get(viewerFounderId)?.startupId ?? null) : null;

  const value = useMemo<EventsValue>(() => {
    const list = events.data
      .filter((e) => isPublishedEvent(e) && canSeeEvent(role, viewerFounderId, startupId, e))
      .sort((a, b) => a.startDateISOString.localeCompare(b.startDateISOString));
    return {
      events: list,
      eventsById: new Map(list.map((e) => [e.id, e])),
      allEventsById: new Map(events.data.map((e) => [e.id, e])),
      isLoading: events.isLoading,
    };
  }, [events.data, events.isLoading, role, viewerFounderId, startupId]);

  return <EventsContextProvider value={value}>{children}</EventsContextProvider>;
}
