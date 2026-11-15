"use client";

import Link from "next/link";
import { Anchor, Text } from "@mantine/core";
import { parisDay } from "@shared/dates";
import { isUpcomingEvent } from "@shared/events";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { useProgram } from "@/context/ProgramContext";
import { formatDateTime, relativeDays } from "@/lib/format";
import { paths } from "@/lib/paths";
import { Section } from "@/components/ui/Section";
import { CardLink } from "@/components/ui/StatTile";

/**
 * « Next session » (accueil du batch) : le prochain evenement que le visiteur
 * voit, quel qu'il soit (`useEvents`, deja filtre par `canSeeEvent`), en cours
 * compris (« Now ») : pendant un hackathon, c'est la qu'on cherche son groupe
 * et ses formulaires. Nom, jour et heure, lieu ; l'encadre ouvre sa page,
 * « See all » l'onglet Calendar. Rien a venir : rien (l'onglet reste la).
 */
export function NextSession() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { events } = useEvents();
  const nowISO = new Date().toISOString();
  const next = events.find((e) => isUpcomingEvent(e, nowISO));
  if (!next) return null;
  const isNow = next.startDateISOString <= nowISO;

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
        <Text fz={22} fw={600} c="white" style={{ overflowWrap: "anywhere" }}>
          {next.name}
        </Text>
        <Text size="sm" c="dimmed" mt={2}>
          <span className="num">{formatDateTime(next.startDateISOString)}</span> ·{" "}
          <Text span c="pioneers" inherit>
            {isNow ? "Now" : relativeDays(parisDay(next.startDateISOString))}
          </Text>
        </Text>
        {next.location && (
          <Text size="sm" c="dimmed">
            {next.location}
          </Text>
        )}
      </CardLink>
    </Section>
  );
}
