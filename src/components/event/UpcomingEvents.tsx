"use client";

import type { ReactNode } from "react";
import { canSeeEvent } from "@shared/access";
import { isUpcomingEvent } from "@shared/events";
import type { Founder, WithId } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { EventRow } from "./EventRow";

/**
 * « Coming up » : les prochains evenements que le visiteur voit (`useEvents`, deja
 * filtre par `canSeeEvent` : ceux du batch et ceux ou il est invite). Masque une
 * fois le batch termine. Accueil du batch et « Me ». Avec `founder` (le staff sur
 * la fiche d'un fondateur) : ceux que CE fondateur voit, prives compris.
 */
export function UpcomingEvents({ limit, right, founder }: { limit: number; right?: ReactNode; founder?: WithId<Founder> }) {
  const { batch } = useBatch();
  const { events, isLoading } = useEvents();
  if (batch.status === "completed") return null;
  const nowISO = new Date().toISOString();
  const upcoming = events
    .filter((e) => isUpcomingEvent(e, nowISO) && (!founder || canSeeEvent("founder", founder.id, founder.startupId, e)))
    .slice(0, limit);

  return (
    <Section title="Coming up" right={right} hint={founder ? "Their events, private ones included." : undefined}>
      {isLoading ? null : upcoming.length === 0 ? (
        <Empty>Nothing scheduled yet.</Empty>
      ) : (
        <RowList>
          {upcoming.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </RowList>
      )}
    </Section>
  );
}
