"use client";

import { parisDay } from "@shared/dates";
import type { PioneersEvent, WithId } from "@shared/types";
import { formatDayTitle } from "@/lib/format";
import { RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";
import { EventRow } from "./EventRow";

type Day = { day: string; events: WithId<PioneersEvent>[] };

/** Regroupe par jour de Paris, dans l'ordre recu. */
function byDay(events: WithId<PioneersEvent>[]): Day[] {
  const days: Day[] = [];
  for (const e of events) {
    const day = parisDay(e.startDateISOString);
    const last = days.at(-1);
    if (last?.day === day) last.events.push(e);
    else days.push({ day, events: [e] });
  }
  return days;
}

/**
 * Des evenements par jour de Paris (`Today · Mon 16 Nov`), chacun en ligne d'agenda
 * (`EventRow timeOnly` : l'heure a gauche du nom), un `Section` par jour (Calendar).
 */
export function EventDays({ events }: { events: WithId<PioneersEvent>[] }) {
  return byDay(events).map(({ day, events }) => (
    <Section key={day} title={formatDayTitle(day)}>
      <RowList>
        {events.map((e) => (
          <EventRow key={e.id} event={e} timeOnly />
        ))}
      </RowList>
    </Section>
  ));
}
