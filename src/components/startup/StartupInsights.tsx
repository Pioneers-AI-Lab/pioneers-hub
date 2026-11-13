"use client";

import Link from "next/link";
import { Anchor, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { STARTUP_SUBSCORES, STARTUP_WEIGHTING_HINT, type Checkin, type MetricKey, type StartupSubScore } from "@shared/types";
import { criterionLabel } from "@shared/presets/eventTemplates";
import { STANDARD_METRICS, withUnit, type StandardMetricKey } from "@shared/presets/standardMetrics";
import { useBatch } from "@/context/BatchContext";
import { useCohort } from "@/context/CohortContext";
import { useEvents } from "@/context/EventsContext";
import { useLeaderboards } from "@/context/LeaderboardsContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartup } from "@/context/StartupContext";
import { formatDay, integer, percent } from "@/lib/format";
import { paths } from "@/lib/paths";
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

type Chart = { key: MetricKey; title: string; format: (v: number) => string; unitPrefix: string };

/** Une courbe d'une cle du dictionnaire : son libelle, et l'euro s'il en a l'unite. */
const standardChart = (key: StandardMetricKey & MetricKey, title?: string): Chart => {
  const m = STANDARD_METRICS[key];
  const eur = m.unit === "EUR";
  return { key, title: title ?? withUnit(m.label, eur ? "€" : null), format: eur ? euro : integer, unitPrefix: eur ? "€" : "" };
};

/** Courbes : totaux a date, puis les conversations de chaque semaine. Le revenu SP26 (definition inconnue) s'il existe. */
const CHARTS: Chart[] = [
  standardChart("totalAmountPaid"),
  standardChart("mrr"),
  standardChart("payingCustomers"),
  standardChart("totalUsers"),
  standardChart("activeUsers"),
  standardChart("conversationsDone", "Conversations per week"),
  { key: "totalRevenue", title: "Total revenue (€, Spring 2026)", format: euro, unitPrefix: "€" },
];

/** La ligne de chiffres d'un update : le pipeline de la semaine, puis les totaux. */
const CHECKIN_NUMBERS: { key: keyof Checkin & MetricKey; text: (v: number) => string }[] = [
  { key: "callsMade", text: (v) => `${integer(v)} calls` },
  { key: "conversationsDone", text: (v) => `${integer(v)} conversations` },
  { key: "meetingsBooked", text: (v) => `${integer(v)} meetings booked` },
  { key: "demosDone", text: (v) => `${integer(v)} demos` },
  { key: "proposalsSent", text: (v) => `${integer(v)} proposals` },
  { key: "closedWon", text: (v) => `${integer(v)} won` },
  { key: "totalAmountPaid", text: (v) => `${euro(v)} paid to date` },
  { key: "mrr", text: (v) => `MRR ${euro(v)}` },
  { key: "payingCustomers", text: (v) => `${integer(v)} paying customers` },
  { key: "activeUsers", text: (v) => `${integer(v)} active users` },
  { key: "revenue", text: (v) => `Revenue ${euro(v)}` },
  { key: "moral", text: (v) => `morale ${v}/10` },
];

/** Les courbes de traction (comme la reference : Total users, Total revenue), puis chaque semaine. */
export function WeeklyUpdates() {
  const { checkins, kpis, canSeeProfile } = useStartup();
  if (!canSeeProfile || checkins.length === 0) return null;

  const charts = CHARTS.map((c) => ({
    ...c,
    points: (kpis?.series[c.key] ?? []).map((p) => ({ label: formatDay(p.weekStartDayString, true), value: p.value })),
  })).filter((c) => c.points.length > 0);

  return (
    <Section title={`Traction · ${checkins.length} weekly updates`}>
      {charts.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {charts.map((c) => (
            <ChartCard key={c.key}>
              <MetricAreaChart title={c.title} points={c.points} format={c.format} unitPrefix={c.unitPrefix} />
            </ChartCard>
          ))}
        </SimpleGrid>
      )}
      <Stack gap="lg" mt="xs">
        {checkins.map((c) => {
          // Un update de Spring 2026 n'a pas les champs du pipeline (absents, pas `null`).
          const numbers = CHECKIN_NUMBERS.flatMap(({ key, text }) => (typeof c[key] === "number" ? [text(c[key])] : []));
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
  const { program } = useProgram();
  const { batch } = useBatch();
  const { startup, evaluations } = useStartup();
  const { eventsById } = useEvents();
  const { leaderboardsByEventId } = useLeaderboards();
  if (evaluations.length === 0) return null;

  const sessions = [...new Set(evaluations.map((e) => e.parentId))]
    .flatMap((eventId) => {
      const event = eventsById.get(eventId);
      return event ? [{ event, evals: evaluations.filter((e) => e.parentId === eventId) }] : [];
    })
    .sort((a, b) => b.event.startDateISOString.localeCompare(a.event.startDateISOString));
  const avg = (evals: typeof evaluations, key: string) => {
    const v = evals.map((e) => e.scores[key]).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const latest = sessions[0];
  // La grille d'une seance : les criteres notes (la grille vit dans le formulaire de jury, SPECS §2), sur 5.
  const gridOf = (evals: typeof evaluations) =>
    [...new Set(evals.flatMap((e) => Object.keys(e.scores)))].map((key) => ({ key, label: criterionLabel(key), max: 5 }));

  return (
    <Section title="Pitches" hint="Jury scores out of 5, per criterion.">
      {latest && (
        <ChartCard title={`Latest · ${latest.event.name}`}>
          <ScoreRadar
            axes={gridOf(latest.evals).map((c) => ({ label: c.label.split(/[ /]/)[0], value: avg(latest.evals, c.key) }))}
            max={5}
            color="orange.5"
            h={200}
          />
        </ChartCard>
      )}
      <Stack gap="lg" mt="xs">
        {sessions.map(({ event, evals }) => {
          // Classee a cette seance : le rang mene au classement complet.
          const board = leaderboardsByEventId.get(event.id);
          const row = board?.rows.find((r) => r.targetId === startup.id);
          return (
            <Stack key={event.id} gap="xs" pb="md" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
              <Group justify="space-between" gap="xs">
                <Text fw={600}>{event.name}</Text>
                <Text size="sm" c="dimmed">
                  {row && (
                    <>
                      <Anchor component={Link} href={paths.leaderboard(program.id, batch.id, event.id)} inherit className="tap-link num">
                        #{row.rank} of {board?.rows.length}
                      </Anchor>
                      {" · "}
                    </>
                  )}
                  {formatDay(event.startDateISOString.slice(0, 10), true)}
                </Text>
              </Group>
              <Stack gap={6}>
                {gridOf(evals).map((c) => {
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
          );
        })}
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
