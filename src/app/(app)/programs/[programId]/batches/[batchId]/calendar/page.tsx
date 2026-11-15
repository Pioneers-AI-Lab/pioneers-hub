"use client";

import { useState } from "react";
import { Box } from "@mantine/core";
import { parisDay } from "@shared/dates";
import { isUpcomingEvent } from "@shared/events";
import type { PioneersEvent, WithId } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { formatDayTitle } from "@/lib/format";
import { AddToCalendarButton } from "@/components/event/AddToCalendar";
import { EventRow } from "@/components/event/EventRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Calendar : l'agenda du batch
// ----------------------------
// Tous les evenements que le visiteur voit (`useEvents`, deja filtre par
// `canSeeEvent` : ceux du batch et ses rendez-vous personnels), un bloc par
// jour de Paris ; chaque ligne ouvre la page de l'evenement. A venir d'abord
// (en cours compris), « Add to calendar » en tete. Les passes restent sur la
// page, replies en bas (« Past events ») : un geste pour retrouver un evenement
// et ses resultats, sans pousser ce qui arrive hors de l'ecran. Rien a venir
// (batch termine) : ils sont deplies d'office.

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

function DaySections({ days }: { days: Day[] }) {
  return days.map(({ day, events }) => (
    <Section key={day} title={formatDayTitle(day)}>
      <RowList>
        {events.map((e) => (
          <EventRow key={e.id} event={e} timeOnly />
        ))}
      </RowList>
    </Section>
  ));
}

export default function CalendarPage() {
  const { batch } = useBatch();
  const { events, isLoading } = useEvents();
  // `null` : le choix par defaut (replie, sauf si rien n'est a venir).
  const [pastOpen, setPastOpen] = useState<boolean | null>(null);

  if (isLoading) return <PageLoader />;

  const nowISO = new Date().toISOString();
  const upcoming = events.filter((e) => isUpcomingEvent(e, nowISO));
  const past = events.filter((e) => !isUpcomingEvent(e, nowISO)).reverse();
  const isPastOpen = pastOpen ?? upcoming.length === 0;

  return (
    <>
      <PageHeader title="Calendar" right={<AddToCalendarButton batchId={batch.id} batchName={batch.name} />} />
      {upcoming.length === 0 ? <Empty>Nothing scheduled yet.</Empty> : <DaySections days={byDay(upcoming)} />}
      {past.length > 0 && (
        <>
          <Box mt="lg">
            <ButtonRow
              onClick={() => setPastOpen(!isPastOpen)}
              expanded={isPastOpen}
              title={`Past events · ${past.length}`}
            />
          </Box>
          {isPastOpen && <DaySections days={byDay(past)} />}
        </>
      )}
    </>
  );
}
