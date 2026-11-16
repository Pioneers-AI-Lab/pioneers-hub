"use client";

import { Box, Stack } from "@mantine/core";
import { parisDay } from "@shared/dates";
import type { PioneersEvent, WithId } from "@shared/types";
import { formatDayTitle } from "@/lib/format";
import { RowList } from "@/components/ui/Rows";
import { Section, SubsectionTitle } from "@/components/ui/Section";
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
 * (`EventRow timeOnly` : l'heure a gauche du nom). Un `Section` par jour (Calendar) ;
 * `nested` : dans une section deja titree (« Coming up »), un `SubsectionTitle` par jour.
 */
export function EventDays({ events, nested = false }: { events: WithId<PioneersEvent>[]; nested?: boolean }) {
  const days = byDay(events);
  if (!nested) {
    return days.map(({ day, events }) => (
      <Section key={day} title={formatDayTitle(day)}>
        <DayRows events={events} />
      </Section>
    ));
  }
  return (
    <Stack gap="sm">
      {days.map(({ day, events }) => (
        <Box key={day}>
          <SubsectionTitle>{formatDayTitle(day)}</SubsectionTitle>
          <DayRows events={events} />
        </Box>
      ))}
    </Stack>
  );
}

function DayRows({ events }: { events: WithId<PioneersEvent>[] }) {
  return (
    <RowList>
      {events.map((e) => (
        <EventRow key={e.id} event={e} timeOnly />
      ))}
    </RowList>
  );
}
