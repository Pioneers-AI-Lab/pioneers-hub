"use client";

import { Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { STARTUP_SUBSCORES, STARTUP_WEIGHTING_HINT, type MetricKey, type StartupSubScore } from "@shared/types";
import { useCohort } from "@/context/CohortContext";
import { useEvents } from "@/context/EventsContext";
import { useStartup } from "@/context/StartupContext";
import { formatDay, integer, percent } from "@/lib/format";
import { Field } from "@/components/ui/Field";
import { ExternalLinkRow, Row, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";
import { ScoreBar, ScoreHeadline } from "@/components/insights/ScoreBar";
import { ChartCard } from "@/components/charts/ChartCard";
import { MarketBubbles } from "@/components/charts/MarketBubbles";
import { MetricAreaChart } from "@/components/charts/MetricAreaChart";
import { RatingDots } from "@/components/charts/RatingDots";
import { ScoreRadar } from "@/components/charts/ScoreRadar";

// ----------------------------
// La fiche startup, cote evaluation (dashboard Spring 2026)
// ----------------------------
// Score, traction semaine par semaine, pitchs,
// marche. Chaque bloc ne s'affiche que si le role a lu ses donnees
// (StartupContext, CohortContext).

const SUBSCORE_LABEL: Record<StartupSubScore, string> = {
  market: "Market",
  team: "Team",
  execution: "Execution",
  traction: "Traction",
};

/** Le score sur 10 et ses quatre sous-scores. */
export function StartupScoreSection() {
  const { startup } = useStartup();
  const { startupScores, startupScoreOf } = useCohort();
  const score = startupScores.get(startup.id);
  if (!score) return null;

  return (
    <Section title="Score" hint={`Data completeness ${percent(score.dataCompleteness)}.`}>
      <ScoreHeadline label="Overall" value={startupScoreOf(startup.id)} hint={STARTUP_WEIGHTING_HINT} />
      <Stack gap="md" mt="xs">
        {STARTUP_SUBSCORES.map((key) => (
          <ScoreBar key={key} label={SUBSCORE_LABEL[key]} value={score.subScores[key]} />
        ))}
      </Stack>
    </Section>
  );
}

const euro = (v: number) => `€${integer(v)}`;

/** Les courbes de traction (comme la reference : Total users, Total revenue), puis chaque semaine. */
export function WeeklyUpdates() {
  const { checkins, kpis, canSeeProfile } = useStartup();
  if (!canSeeProfile || checkins.length === 0) return null;

  const series = (key: MetricKey) =>
    (kpis?.series[key] ?? []).map((p) => ({ label: formatDay(p.weekStartDayString, true), value: p.value }));
  const charts = [
    { key: "totalUsers" as const, title: "Total users", format: integer },
    { key: "totalRevenue" as const, title: "Total revenue (€)", format: euro, unitPrefix: "€" },
    { key: "activeUsers" as const, title: "Active users", format: integer },
    { key: "interviews" as const, title: "Interviews per week", format: integer },
  ].filter((c) => series(c.key).length > 0);

  return (
    <Section title={`Traction · ${checkins.length} weekly updates`}>
      {charts.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {charts.map((c) => (
            <ChartCard key={c.key}>
              <MetricAreaChart title={c.title} points={series(c.key)} format={c.format} unitPrefix={"unitPrefix" in c ? c.unitPrefix : ""} />
            </ChartCard>
          ))}
        </SimpleGrid>
      )}
      <Stack gap="lg" mt="xs">
        {checkins.map((c) => {
          const numbers = [
            c.revenue !== null ? `Revenue ${integer(c.revenue)}` : null,
            c.activeUsers !== null ? `${integer(c.activeUsers)} active users` : null,
            c.interviews !== null ? `${integer(c.interviews)} interviews` : null,
            c.moral !== null ? `morale ${c.moral}/10` : null,
          ].filter(Boolean);
          return (
            <Stack key={c.id} gap="xs" pb="md" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
              <Text fw={600}>Week of {formatDay(c.weekStartDayString, true)}</Text>
              {numbers.length > 0 && (
                <Text size="sm" c="dimmed" className="num">
                  {numbers.join(" · ")}
                </Text>
              )}
              <Field label="Achievement">{c.achievement}</Field>
              <Field label="Goals">{c.goals}</Field>
              <Field label="Obstacle">{c.obstacle}</Field>
              <Field label="Learned">{c.learned}</Field>
            </Stack>
          );
        })}
      </Stack>
    </Section>
  );
}

/** Notes des pitchs (staff et IC) : radar de la derniere seance, puis chaque seance critere par critere. */
export function PitchEvaluations() {
  const { evaluations } = useStartup();
  const { eventsById } = useEvents();
  if (evaluations.length === 0) return null;

  const sessions = [...new Set(evaluations.map((e) => e.parentId))]
    .map((eventId) => ({ event: eventsById.get(eventId), evals: evaluations.filter((e) => e.parentId === eventId) }))
    .filter((s) => s.event)
    .sort((a, b) => b.event!.startDateISOString.localeCompare(a.event!.startDateISOString));
  const avg = (evals: typeof evaluations, key: string) => {
    const v = evals.map((e) => e.scores[key]).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const latest = sessions[0];

  return (
    <Section title="Pitches" hint="Jury scores out of 5, per criterion.">
      {latest && (
        <ChartCard title={`Latest · ${latest.event!.name}`}>
          <ScoreRadar
            axes={latest.event!.criteria.map((c) => ({ label: c.label.split(/[ /]/)[0], value: avg(latest.evals, c.key) }))}
            max={5}
            color="orange.5"
            h={200}
          />
        </ChartCard>
      )}
      <Stack gap="lg" mt="xs">
        {sessions.map(({ event, evals }) => (
          <Stack key={event!.id} gap="xs" pb="md" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
            <Group justify="space-between" gap="xs">
              <Text fw={600}>{event!.name}</Text>
              <Text size="sm" c="dimmed">
                {formatDay(event!.startDateISOString.slice(0, 10), true)}
              </Text>
            </Group>
            <Stack gap={6}>
              {event!.criteria.map((c) => {
                const v = avg(evals, c.key);
                return (
                  <Group key={c.key} justify="space-between" gap="xs" wrap="nowrap">
                    <Text size="sm" c="dimmed" truncate>
                      {c.label}
                    </Text>
                    <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
                      <RatingDots value={v} max={c.max} color="orange.5" />
                      <Text size="xs" className="num" w={22} ta="right">
                        {v === null ? "-" : v.toFixed(1)}
                      </Text>
                    </Group>
                  </Group>
                );
              })}
            </Stack>
            {evals
              .filter((e) => e.comment)
              .map((e) => (
                <Text key={e.id} size="sm" c="dark.1" style={{ whiteSpace: "pre-wrap" }}>
                  {e.comment}
                </Text>
              ))}
          </Stack>
        ))}
      </Stack>
    </Section>
  );
}

/** Analyse de marche generee : bulles TAM / SAM / SOM, puis concurrents et sources. */
export function MarketAnalysisSection() {
  const { profile } = useStartup();
  const market = profile?.marketAnalysis;
  if (!market) return null;

  return (
    <Section title="Market">
      <ChartCard>
        <MarketBubbles
          cagr={market.cagr.mid}
          sizes={[
            { key: "tam", ...market.tam },
            { key: "sam", ...market.sam },
            { key: "som", ...market.som },
          ]}
        />
      </ChartCard>
      <Stack gap="md" mt="xs">
        <Field label="Problem">{market.problemOneLiner ?? market.aiSummaryProblem}</Field>
        <Field label="Solution">{market.solutionOneLiner ?? market.aiSummarySolution}</Field>
        <Field label="Why now">{market.whyNowOneLiner ?? market.aiSummaryTiming}</Field>
        <Field label="ICP">{market.icpOneLiner}</Field>
      </Stack>
      {market.competitors.length > 0 && (
        <Stack gap={0} mt="xs">
          <span className="label">Competitors · {market.competitors.length}</span>
          <RowList>
            {market.competitors.map((c) => {
              const props = {
                title: c.name,
                subtitle: c.description ?? undefined,
                meta: [c.stage, c.raised].filter(Boolean).join(" · ") || undefined,
              };
              // Toute la ligne ouvre le site du concurrent.
              return c.domain ? <ExternalLinkRow key={c.name} href={c.domain} {...props} /> : <Row key={c.name} {...props} />;
            })}
          </RowList>
        </Stack>
      )}
      {market.sources.length > 0 && (
        <Stack gap={0} mt="xs">
          <span className="label">Sources</span>
          {market.sources.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              style={{ display: "block", padding: "10px 0", fontSize: 13, color: "var(--mantine-color-pioneers-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {url.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
          ))}
        </Stack>
      )}
    </Section>
  );
}
