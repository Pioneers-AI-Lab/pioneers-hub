"use client";

import { Text } from "@mantine/core";
import type { PioneersEvent, WithId } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { formatDateTime, formatTime, formatEndPlace } from "@/lib/format";
import { paths } from "@/lib/paths";
import { LinkRow } from "@/components/ui/Rows";
import { shownEventLabel } from "./eventLabels";

/**
 * Un evenement : nom, date et lieu, etiquette a droite quand elle apprend quelque chose
 * (`shownEventLabel`). La ligne ouvre la page de l'evenement : ce qui lui est attache.
 * `timeOnly` : sous un titre de jour (Calendar), sans repeter la date : l'heure de debut
 * a gauche du nom, dans son style, et `Until fin · lieu` dessous.
 */
export function EventRow({
  event,
  timeOnly = false,
}: {
  event: WithId<
    Pick<PioneersEvent, "name" | "startDateISOString" | "endDateISOString" | "location" | "kind" | "templateKey">
  >;
  timeOnly?: boolean;
}) {
  const { program } = useProgram();
  const { batch } = useBatch();
  const start = event.startDateISOString;
  return (
    <LinkRow
      href={paths.event(program.id, batch.id, event.id)}
      // En haut de la ligne (`.row` centre ses enfants) : sur la ligne du nom.
      leading={
        timeOnly && (
          <Text fw={500} className="num" style={{ flexShrink: 0, alignSelf: "flex-start" }}>
            {formatTime(start)}
          </Text>
        )
      }
      title={event.name}
      subtitle={
        timeOnly ? formatEndPlace(event) : [formatDateTime(start), event.location].filter(Boolean).join(" · ")
      }
      meta={shownEventLabel(event)}
    />
  );
}
