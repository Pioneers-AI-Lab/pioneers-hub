"use client";

import Link from "next/link";
import { Anchor, Stack, Text, Title } from "@mantine/core";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { formatDateTime, formatDay, formatPeriod, relativeDays, todayDayString } from "@/lib/format";
import { paths } from "@/lib/paths";
import { LinkRow, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import { EVENT_KIND_LABEL } from "@/components/event/eventLabels";

export default function BatchHomePage() {
  const { program } = useProgram();
  const { batch, role } = useBatch();
  const { founders } = useFounders();
  const { startups } = useStartups();
  const { events, isLoading: isEventsLoading } = useEvents();

  const today = todayDayString();
  const nowISO = new Date().toISOString();
  const dated = batch.milestones.filter((m) => m.dayString);
  const next = dated.find((m) => m.dayString! >= today) ?? null;
  const upcoming = events.filter((e) => (e.endDateISOString ?? e.startDateISOString) >= nowISO).slice(0, 4);

  return (
    <Stack gap={0}>
      <Title order={2}>{batch.name}</Title>
      <Text size="sm" c="dimmed" className="num">
        {formatPeriod(batch.startDayString, batch.endDayString)}
      </Text>

      {next && (
        <Stack gap={2} mt="lg" p="md" style={{ border: "1px solid var(--mantine-color-dark-4)", borderRadius: 12 }}>
          <span className="label">Next milestone</span>
          <Text fz={22} fw={600}>
            {next.label}
          </Text>
          <Text size="sm" c="dimmed">
            <span className="num">{formatDay(next.dayString)}</span> · <Text span c="pioneers" inherit>{relativeDays(next.dayString!)}</Text>
          </Text>
        </Stack>
      )}

      <Stack mt="lg" gap={0}>
        <StatGrid>
          <StatTile label={role === "public" ? "Public profiles" : "Founders"} value={founders.length} href={paths.founders(program.id, batch.id)} />
          <StatTile label="Startups" value={startups.length} href={paths.startups(program.id, batch.id)} />
        </StatGrid>
      </Stack>

      {role === "public" && (
        <Text size="sm" c="dimmed" mt="md">
          Founders of this batch:{" "}
          <Anchor component={Link} href={paths.signIn(paths.batch(program.id, batch.id))} inherit>
            sign in
          </Anchor>{" "}
          to see everyone.
        </Text>
      )}

      <Section title="Coming up">
        {isEventsLoading ? null : upcoming.length === 0 ? (
          <Empty>Nothing scheduled yet.</Empty>
        ) : (
          <RowList>
            {upcoming.map((e) => (
              <Row
                key={e.id}
                title={e.name}
                subtitle={[formatDateTime(e.startDateISOString), e.location].filter(Boolean).join(" · ")}
                meta={EVENT_KIND_LABEL[e.kind]}
              />
            ))}
          </RowList>
        )}
      </Section>

      <Section title="Results">
        <RowList>
          <LinkRow href={paths.leaderboard(program.id, batch.id)} title="Leaderboard" subtitle="Jury scores by event" />
        </RowList>
      </Section>

      <Section title="Milestones">
        <RowList>
          {batch.milestones.map((m) => (
            <Row
              key={m.key}
              title={m.label}
              meta={
                <Text size="sm" c={!m.dayString || m.dayString < today ? "dimmed" : undefined} className={m.dayString ? "num" : undefined}>
                  {m.dayString ? formatDay(m.dayString) : "To be set"}
                </Text>
              }
            />
          ))}
        </RowList>
      </Section>
    </Stack>
  );
}
