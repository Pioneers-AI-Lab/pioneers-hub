"use client";

import type { PioneersEvent, WithId } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { formatDateTime, formatTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { LinkRow } from "@/components/ui/Rows";
import { eventLabel } from "./eventLabels";

/**
 * Un evenement : nom, date et lieu, etiquette a droite (To do, Me, Calendar). La
 * ligne ouvre la page de l'evenement : ce qui lui est attache. `timeOnly` : sous un
 * titre de jour (Calendar), l'heure seule, sans repeter la date.
 */
export function EventRow({
  event,
  timeOnly = false,
}: {
  event: WithId<Pick<PioneersEvent, "name" | "startDateISOString" | "location" | "kind" | "templateKey">>;
  timeOnly?: boolean;
}) {
  const { program } = useProgram();
  const { batch } = useBatch();
  return (
    <LinkRow
      href={paths.event(program.id, batch.id, event.id)}
      title={event.name}
      subtitle={[(timeOnly ? formatTime : formatDateTime)(event.startDateISOString), event.location].filter(Boolean).join(" · ")}
      meta={eventLabel(event)}
    />
  );
}
