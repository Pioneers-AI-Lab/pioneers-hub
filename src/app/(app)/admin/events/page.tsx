"use client";

import { useState } from "react";
import { Box, Button, Group, SegmentedControl, Text } from "@mantine/core";
import { calendarIdOf } from "@shared/calendarSync";
import { eventPhaseOf, type EventPhase } from "@shared/events";
import type { PioneersEvent, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAction } from "@/hooks/useAction";
import { call } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { ActionBar } from "@/components/admin/ActionBar";
import { CalendarSyncStatus } from "@/components/admin/CalendarSyncStatus";
import { EVENT_PHASE_STYLE, EVENT_STATUS_LABEL, archiveWords, eventLabel } from "@/components/event/eventLabels";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, SectionTitle } from "@/components/ui/Section";

// ----------------------------
// Admin > Events : tous les evenements du batch, en une liste
// ----------------------------
// L'en-tete et « + Create » restent a l'ecran, seule la liste defile
// (`.fixed-page`). Toujours du plus lointain (en haut) au plus ancien (en
// bas) ; « Upcoming » ne garde que ceux a venir, « All » ajoute les passes et
// les archives. Couleur de la phase (`eventPhaseOf`, `EVENT_PHASE_STYLE`).
// « + Create » ouvre la page d'un evenement neuf (EventEditor), en brouillon
// par defaut : invisible des fondateurs et du calendrier tant qu'il n'est pas
// « Scheduled ».
// Batch relie a un agenda Google (SPECS §2, 16/11) : pas de « + Create » (on cree
// dans l'agenda), mais « Sync now » et l'heure de la derniere synchro.

type Filter = "upcoming" | "all";

export default function AdminEventsPage() {
  const { batch, events, archivedEvents } = useAdmin();
  const [filter, setFilter] = useState<Filter>("upcoming");
  const nowISO = new Date().toISOString();

  // Les archives sont toujours « past » : le filtre « Upcoming » les ecarte.
  const rows = [...events, ...archivedEvents]
    .map((e) => ({ event: e, phase: eventPhaseOf(e, nowISO) }))
    .filter((r) => filter === "all" || r.phase !== "past")
    .sort((a, b) => (a.event.startDateISOString < b.event.startDateISOString ? 1 : -1));

  return (
    <div className="fixed-page">
      <PageHeader back={{ href: paths.admin(), label: "Admin" }} title="Events" help="Every event of the batch: schedule, settings, archive." />
      <BatchPicker />
      <Group justify="space-between" gap="xs" wrap="nowrap" mt="lg" mb="xs">
        <SectionTitle>Events · {rows.length}</SectionTitle>
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          data={[
            { value: "upcoming", label: "Upcoming" },
            { value: "all", label: "All" },
          ]}
        />
      </Group>
      <div className="fixed-page-scroll">
        {rows.length === 0 ? (
          <Empty>{filter === "upcoming" ? `Nothing coming up in ${batch.name}.` : `No event in ${batch.name} yet.`}</Empty>
        ) : (
          <RowList>
            {rows.map(({ event, phase }) => (
              <AdminEventRow key={event.id} event={event} phase={phase} />
            ))}
          </RowList>
        )}
      </div>
      {calendarIdOf(batch) ? <CalendarSyncBar batchId={batch.id} /> : <ActionBar label="+ Create" href={paths.adminEventNew()} />}
    </div>
  );
}

/** Les evenements viennent de l'agenda : la derniere synchro, et la relancer tout de suite. */
function CalendarSyncBar({ batchId }: { batchId: string }) {
  const { isBusy, run } = useAction();
  return (
    <Box className="savebar">
      <CalendarSyncStatus batchId={batchId} mb="xs" />
      <Button size="md" fullWidth loading={isBusy} onClick={() => void run(() => call("syncBatchCalendar")({ batchId }), "Events synced")}>
        Sync with Google Calendar now
      </Button>
    </Box>
  );
}

function statusLabel(e: PioneersEvent, phase: EventPhase): string {
  if (e.archivedDateISOString) return archiveWords(e).state;
  if (phase === "today" && e.status !== "live") return "Today";
  return EVENT_STATUS_LABEL[e.status];
}

function AdminEventRow({ event: e, phase }: { event: WithId<PioneersEvent>; phase: EventPhase }) {
  const { dot, color } = EVENT_PHASE_STYLE[phase];
  const past = phase === "past";
  return (
    <LinkRow
      href={paths.adminEvent(e.id)}
      leading={<Box w={8} h={8} bg={dot} style={{ borderRadius: 99, flexShrink: 0 }} />}
      title={past ? <Text span inherit c="dimmed">{e.name}</Text> : e.name}
      subtitle={[formatDateTime(e.startDateISOString), e.location, eventLabel(e)].filter(Boolean).join(" · ")}
      meta={
        <Text size="sm" fw={past ? undefined : 600} c={color}>
          {statusLabel(e, phase)}
        </Text>
      }
    />
  );
}
