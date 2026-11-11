"use client";

import Link from "next/link";
import { Anchor, Button, Divider, Stack, Text, Title } from "@mantine/core";
import { IconBrandSlack } from "@tabler/icons-react";
import { slackChannelUrl } from "@shared/slackLinks";
import { STARTUP_WEIGHTING_HINT } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useCohort } from "@/context/CohortContext";
import { useEvents } from "@/context/EventsContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { PROFILE_CATEGORY_LABEL, formatDateTime, formatDay, formatPeriod, percent, relativeDays, score10, todayDayString } from "@/lib/format";
import { paths } from "@/lib/paths";
import { LinkRow, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import { ChartCard } from "@/components/charts/ChartCard";
import { NationalityMap } from "@/components/charts/NationalityMap";
import { ProfileDonut } from "@/components/charts/ProfileDonut";
import { RankedBars } from "@/components/charts/RankedBars";
import { EVENT_KIND_LABEL } from "@/components/event/eventLabels";

// ----------------------------
// Accueil du batch
// ----------------------------
// Prochain jalon, la cohorte (vue d'ensemble du dashboard Spring 2026 :
// effectif, experience, profils, competences, nationalites), les meilleurs
// fondateurs et startups (staff et investors), ce qui arrive, les jalons.
export default function BatchHomePage() {
  const { program } = useProgram();
  const { batch, role } = useBatch();
  const { founders } = useFounders();
  const { startups } = useStartups();
  const { events, isLoading: isEventsLoading } = useEvents();
  const { stats, canSeeScores, founderPerformance, startupScoreOf } = useCohort();

  const today = todayDayString();
  const nowISO = new Date().toISOString();
  const next = batch.milestones.find((m) => m.dayString && m.dayString >= today) ?? null;
  // Canal Slack du batch : pour ceux qui en font partie (pas un visiteur public).
  const slackTeamId = batch.settings.slackTeamId ?? null;
  const slackChannel =
    role !== "public" && slackTeamId && batch.settings.slackChannelId ? slackChannelUrl(slackTeamId, batch.settings.slackChannelId) : null;
  const upcoming = events.filter((e) => (e.endDateISOString ?? e.startDateISOString) >= nowISO).slice(0, 4);

  const topFounders = canSeeScores
    ? founders
        .map((f) => ({ f, score: founderPerformance(f.id) }))
        .filter((x) => x.score !== null)
        .sort((a, b) => b.score! - a.score!)
        .slice(0, 5)
    : [];
  const topStartups = canSeeScores
    ? startups
        .map((s) => ({ s, score: startupScoreOf(s.id) }))
        .filter((x) => x.score !== null)
        .sort((a, b) => b.score! - a.score!)
        .slice(0, 5)
    : [];

  return (
    <Stack gap={0}>
      <Title order={2}>{batch.name}</Title>
      <Text size="sm" c="dimmed" className="num">
        {formatPeriod(batch.startDayString, batch.endDayString)}
        {batch.status === "completed" ? " · Completed" : ""}
      </Text>
      {slackChannel && (
        <Button
          component="a"
          href={slackChannel}
          target="_blank"
          rel="noreferrer"
          variant="default"
          size="sm"
          radius="xl"
          mt="sm"
          w="fit-content"
          leftSection={<IconBrandSlack size={16} stroke={1.75} />}
        >
          Batch channel
        </Button>
      )}

      {next && (
        <Stack gap={2} mt="lg" p="md" style={{ border: "1px solid var(--mantine-color-dark-4)", borderRadius: 12 }}>
          <span className="label">Next milestone</span>
          <Text fz={22} fw={600}>
            {next.label}
          </Text>
          <Text size="sm" c="dimmed">
            {formatDay(next.dayString)} · <Text span c="pioneers" inherit>{relativeDays(next.dayString!)}</Text>
          </Text>
        </Stack>
      )}

      <Stack mt="lg" gap={0}>
        <StatGrid>
          <StatTile
            label={role === "public" ? "Public profiles" : "Founders"}
            value={role === "public" ? founders.length : (stats?.founders ?? founders.length)}
            href={paths.founders(program.id, batch.id)}
          />
          <StatTile label="Startups" value={startups.length} href={paths.startups(program.id, batch.id)} />
          {stats?.avgYearsOfXP !== null && stats?.avgYearsOfXP !== undefined && (
            <StatTile label="Avg years of XP" value={stats.avgYearsOfXP.toFixed(1)} />
          )}
          {stats?.repeatFounders !== null && stats?.repeatFounders !== undefined && (
            <StatTile label="Repeat founders" value={percent(stats.repeatFounders)} />
          )}
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

      {stats && (
        <Stack gap="sm" mt="lg">
          <ChartCard title="Profile distribution">
            <ProfileDonut
              slices={(["technical", "business", "hybrid"] as const).map((k) => ({
                key: k,
                label: PROFILE_CATEGORY_LABEL[k],
                value: stats.profileDistribution[k] ?? 0,
              }))}
            />
            <Divider color="dark.4" />
            <RankedBars
              bars={Object.entries(stats.skillsDistribution).map(([k, v]) => ({ key: k, label: k, value: v }))}
              limit={6}
            />
          </ChartCard>
          <ChartCard title={`Nationalities · ${Object.keys(stats.nationalities).length}`}>
            <NationalityMap counts={stats.nationalities} />
          </ChartCard>
        </Stack>
      )}

      {topFounders.length > 0 && (
        <Section title="Top founders" hint="Program performance, out of 10.">
          <RowList>
            {topFounders.map(({ f, score }) => (
              <LinkRow
                key={f.id}
                href={paths.founder(program.id, batch.id, f.id)}
                avatar={{ name: f.name, photoUrl: f.photoUrl }}
                title={f.name}
                subtitle={f.trackRecordOneLiner ?? undefined}
                meta={<Text fw={600} className="num">{score10(score)}</Text>}
              />
            ))}
          </RowList>
        </Section>
      )}

      {topStartups.length > 0 && (
        <Section title="Top startups" hint={`${STARTUP_WEIGHTING_HINT}.`}>
          <RowList>
            {topStartups.map(({ s, score }) => (
              <LinkRow
                key={s.id}
                href={paths.startup(program.id, batch.id, s.id)}
                avatar={{ name: s.name, photoUrl: s.logoUrl }}
                title={s.name}
                subtitle={s.ideaOneLine ?? undefined}
                meta={<Text fw={600} className="num">{score10(score)}</Text>}
              />
            ))}
          </RowList>
        </Section>
      )}

      {batch.status !== "completed" && (
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
      )}

      <Section title="Results">
        <RowList>
          <LinkRow href={paths.leaderboard(program.id, batch.id)} title="Leaderboard" subtitle="Jury scores by event" />
        </RowList>
      </Section>

      <Section title="Milestones">
        <RowList>
          {batch.milestones
            .filter((m) => m.dayString || batch.status !== "completed")
            .map((m) => (
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
