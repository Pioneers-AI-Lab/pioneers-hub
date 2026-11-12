"use client";

import Link from "next/link";
import { Button, Stack, Text } from "@mantine/core";
import dayjs from "dayjs";
import { openPicks } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useChallengeTasks } from "@/context/ChallengeTasksContext";
import { useMyPicks } from "@/context/MyPicksContext";
import { useEvents } from "@/context/EventsContext";
import { useFounder } from "@/context/FounderContext";
import { useOpenForms } from "@/context/OpenFormsContext";
import { useProgram } from "@/context/ProgramContext";
import { missingProfileFields } from "@/lib/completeness";
import { debriefStatus } from "@/lib/debrief";
import { picksSubtitle } from "@/lib/picks";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { EVENT_KIND_LABEL } from "@/components/event/eventLabels";

// « A faire » (SPECS §3.1) : ce qui manque a mon profil, les formulaires
// ouverts et leur echeance, le Debrief des hackathons, ce qui arrive cette semaine.
export default function TodoPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founder, directory, profile, isDetailsLoading } = useFounder();
  const { forms, isLoading: isFormsLoading } = useOpenForms();
  const { events } = useEvents();
  // Le Debrief (callable, plus lente a froid) et les choix ne bloquent pas la page : leur section attend.
  const { tasks, isLoading: isTasksLoading } = useChallengeTasks();
  const { picksByEventId, isLoading: isPicksLoading } = useMyPicks();

  if (isDetailsLoading || isFormsLoading) return <PageLoader />;

  const missing = missingProfileFields(founder, directory, profile);
  const required = missing.filter((m) => m.required);
  const now = dayjs();
  const thisWeek = events.filter((e) => {
    const start = dayjs(e.startDateISOString);
    return start.isAfter(now.subtract(2, "hour")) && start.isBefore(now.add(7, "day"));
  });
  const debriefs = tasks.map((t) => ({ task: t, ...debriefStatus(t) }));
  const nowISO = now.toISOString();
  const picksToGive = events.flatMap((e) => {
    const picks = openPicks(e, nowISO);
    return picks ? [{ event: e, picks, given: picksByEventId.get(e.id) ?? null }] : [];
  });
  const nothing =
    !isTasksLoading &&
    !isPicksLoading &&
    missing.length === 0 &&
    forms.length === 0 &&
    thisWeek.length === 0 &&
    debriefs.every((d) => d.done) &&
    picksToGive.length === 0;

  return (
    <>
      <PageHeader title="To do" />
      {nothing && <Empty>You are all set. New forms and events show up here.</Empty>}

      {missing.length > 0 && (
        <Section
          title="Your profile"
          hint={
            required.length > 0
              ? `${required.length} required ${required.length === 1 ? "field is" : "fields are"} empty. Other founders look for co-founders with these.`
              : "A few useful fields are still empty."
          }
        >
          <Text size="sm">{missing.map((m) => m.label).join(", ")}</Text>
          <Button component={Link} href={paths.meEdit(program.id, batch.id)} size="md" mt="xs" fullWidth maw={400}>
            Complete my profile
          </Button>
        </Section>
      )}

      {forms.length > 0 && (
        <Section title="Forms">
          <RowList>
            {forms.map((f) => (
              <LinkRow
                key={f.id}
                href={paths.form(f.id)}
                title={f.title}
                subtitle={f.description ?? undefined}
                meta={
                  f.deadlineDateISOString ? (
                    <Text size="sm" c={dayjs(f.deadlineDateISOString).diff(now, "hour") < 24 ? "pioneers" : "dimmed"}>
                      Due {formatDateTime(f.deadlineDateISOString)}
                    </Text>
                  ) : undefined
                }
              />
            ))}
          </RowList>
        </Section>
      )}

      {!isPicksLoading && picksToGive.length > 0 && (
        <Section title="Picks" hint="Private: only the Pioneers team sees your choices.">
          <RowList>
            {picksToGive.map(({ event, picks, given }) => (
              <LinkRow
                key={event.id}
                href={paths.picks(program.id, batch.id, event.id)}
                title={picks.question}
                subtitle={picksSubtitle(event.name, picks)}
                meta={
                  <Text size="sm" c={given ? "dimmed" : "pioneers"}>
                    {given ? `${given.pickedFounderIds.length} picked` : `Top ${picks.max}`}
                  </Text>
                }
              />
            ))}
          </RowList>
        </Section>
      )}

      {debriefs.length > 0 && (
        <Section title="Hackathons" hint="Your team's results and a word on each teammate, after every hackathon.">
          <RowList>
            {debriefs.map(({ task, toRate, resultsMissing, done }) => (
              <LinkRow
                key={task.eventId}
                href={paths.debrief(program.id, batch.id, task.eventId)}
                title={task.eventName}
                subtitle={task.team.name}
                meta={
                  <Text size="sm" c={done ? "dimmed" : "pioneers"}>
                    {done
                      ? "Done"
                      : [resultsMissing && "Results", toRate > 0 && `${toRate} to rate`].filter(Boolean).join(" · ")}
                  </Text>
                }
              />
            ))}
          </RowList>
        </Section>
      )}

      {thisWeek.length > 0 && (
        <Section title="This week">
          <Stack gap={0}>
            <RowList>
              {thisWeek.map((e) => (
                <Row
                  key={e.id}
                  title={e.name}
                  subtitle={[formatDateTime(e.startDateISOString), e.location].filter(Boolean).join(" · ")}
                  meta={EVENT_KIND_LABEL[e.kind]}
                />
              ))}
            </RowList>
          </Stack>
        </Section>
      )}
    </>
  );
}
