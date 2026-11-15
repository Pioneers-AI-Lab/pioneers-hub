"use client";

import { canSeeEvent } from "@shared/access";
import { isUpcomingEvent } from "@shared/events";
import type { Founder, WithId } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { EventRow } from "./EventRow";

/**
 * « Coming up », sur « Me » : les prochains evenements que le visiteur voit
 * (`useEvents`, deja filtre par `canSeeEvent` : ceux du batch et ceux ou il est
 * invite). L'accueil du batch a « Next session », et l'onglet Calendar tout
 * l'agenda. Avec `founder` (le staff sur la fiche d'un fondateur) : ceux que CE
 * fondateur voit, prives compris. Masque une fois le batch termine.
 */
export function UpcomingEvents({ limit, founder }: { limit: number; founder?: WithId<Founder> }) {
  const { batch } = useBatch();
  const { events, isLoading } = useEvents();
  if (batch.status === "completed") return null;
  const nowISO = new Date().toISOString();
  const upcoming = events
    .filter((e) => isUpcomingEvent(e, nowISO) && (!founder || canSeeEvent("founder", founder.id, founder.startupId, e)))
    .slice(0, limit);

  return (
    <Section title="Coming up" hint={founder ? "Their events, private ones included." : undefined}>
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
