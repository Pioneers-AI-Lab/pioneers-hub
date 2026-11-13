"use client";

import { useState } from "react";
import { Box, Group, SegmentedControl, Text } from "@mantine/core";
import { eventPhaseOf, type EventPhase } from "@shared/events";
import type { PioneersEvent, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { ActionBar } from "@/components/admin/ActionBar";
import { EVENT_PHASE_STYLE, EVENT_STATUS_LABEL, eventLabel } from "@/components/event/eventLabels";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty } from "@/components/ui/Section";

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
      <PageHeader back={{ href: paths.admin(), label: "Admin" }} title="Events" subtitle="Every event of the batch: schedule, settings, archive." />
      <BatchPicker />
      <Group justify="space-between" gap="xs" wrap="nowrap" mt="lg" mb="xs">
        <span className="label">Events · {rows.length}</span>
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
      <ActionBar label="+ Create" href={paths.adminEventNew()} />
    </div>
  );
}

function statusLabel(e: PioneersEvent, phase: EventPhase): string {
  if (e.archivedDateISOString) return "Archived";
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
