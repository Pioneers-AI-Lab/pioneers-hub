"use client";

import { useState } from "react";
import { Box } from "@mantine/core";
import { isUpcomingEvent } from "@shared/events";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { AddToCalendarButton } from "@/components/event/AddToCalendar";
import { EventDays } from "@/components/event/EventDays";
import { PageLoader } from "@/components/ui/PageLoader";
import { ButtonRow } from "@/components/ui/Rows";
import { Empty } from "@/components/ui/Section";

// ----------------------------
// Calendar : l'agenda du batch
// ----------------------------
// Tous les evenements que le visiteur voit (`useEvents`, deja filtre par
// `canSeeEvent` : ceux du batch et ses rendez-vous personnels), un bloc par
// jour de Paris ; chaque ligne ouvre la page de l'evenement. A venir d'abord
// (en cours compris), « Add to calendar » en bas. Les passes restent sur la
// page, replies en bas (« Past events ») : un geste pour retrouver un evenement
// et ses resultats, sans pousser ce qui arrive hors de l'ecran. Rien a venir
// (batch termine) : ils sont deplies d'office.

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
      {upcoming.length === 0 ? <Empty>Nothing scheduled yet.</Empty> : <EventDays events={upcoming} />}
      {past.length > 0 && (
        <>
          <Box mt="lg">
            <ButtonRow
              onClick={() => setPastOpen(!isPastOpen)}
              expanded={isPastOpen}
              title={`Past events · ${past.length}`}
            />
          </Box>
          {isPastOpen && <EventDays events={past} />}
        </>
      )}
      <Box mt="lg">
        <AddToCalendarButton batchId={batch.id} batchName={batch.name} />
      </Box>
    </>
  );
}
