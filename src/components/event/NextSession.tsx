"use client";

import Link from "next/link";
import { Anchor, Box, Group, Text } from "@mantine/core";
import { parisDay } from "@shared/dates";
import { isUpcomingEvent } from "@shared/events";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { useProgram } from "@/context/ProgramContext";
import { formatTime, formatTimePlace, formatWeekDay, relativeDays } from "@/lib/format";
import { paths } from "@/lib/paths";
import { Section } from "@/components/ui/Section";
import { CardLink } from "@/components/ui/StatTile";

/**
 * « Next session » (accueil du batch) : le prochain evenement que le visiteur
 * voit, quel qu'il soit (`useEvents`, deja filtre par `canSeeEvent`), en cours
 * compris (« Now ») : pendant un hackathon, c'est la qu'on cherche son groupe
 * et ses formulaires. Comme une ligne du Calendar : l'heure de debut a gauche du
 * nom, dans son style, `debut–fin · lieu` dessous ; puis le jour et son ecart a
 * aujourd'hui. L'encadre ouvre sa page, « See all » l'onglet Calendar. Rien a
 * venir : rien (l'onglet reste la).
 */
export function NextSession() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { events } = useEvents();
  const nowISO = new Date().toISOString();
  const next = events.find((e) => isUpcomingEvent(e, nowISO));
  if (!next) return null;
  const start = next.startDateISOString;
  const day = parisDay(start);

  return (
    <Section
      title="Next session"
      right={
        <Anchor component={Link} href={paths.calendar(program.id, batch.id)} size="sm" className="tap-link">
          See all
        </Anchor>
      }
    >
      <CardLink href={paths.event(program.id, batch.id, next.id)}>
        <Group gap={12} wrap="nowrap" align="flex-start">
          <Text fz={22} fw={600} c="white" className="num" style={{ flexShrink: 0 }}>
            {formatTime(start)}
          </Text>
          <Box style={{ minWidth: 0 }}>
            <Text fz={22} fw={600} c="white" style={{ overflowWrap: "anywhere" }}>
              {next.name}
            </Text>
            <Text size="sm" c="dimmed" mt={2} className="num">
              {formatTimePlace(next)}
            </Text>
            <Text size="sm" c="dimmed">
              {formatWeekDay(day)} ·{" "}
              <Text span c="pioneers" inherit>
                {start <= nowISO ? "Now" : relativeDays(day)}
              </Text>
            </Text>
          </Box>
        </Group>
      </CardLink>
    </Section>
  );
}
