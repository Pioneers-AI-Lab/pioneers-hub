"use client";

import type { PioneersEvent, WithId } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { LinkRow } from "@/components/ui/Rows";
import { eventLabel } from "./eventLabels";

/**
 * Un evenement : nom, date et lieu, etiquette a droite (accueil du batch, To do,
 * Me). La ligne ouvre la page de l'evenement : ce qui lui est attache.
 */
export function EventRow({ event }: { event: WithId<Pick<PioneersEvent, "name" | "startDateISOString" | "location" | "kind" | "templateKey">> }) {
  const { program } = useProgram();
  const { batch } = useBatch();
  return (
    <LinkRow
      href={paths.event(program.id, batch.id, event.id)}
      title={event.name}
      subtitle={[formatDateTime(event.startDateISOString), event.location].filter(Boolean).join(" · ")}
      meta={eventLabel(event)}
    />
  );
}
