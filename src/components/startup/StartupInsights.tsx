"use client";

import Link from "next/link";
import { Anchor, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import {
  EVALUATION_DECISION_LABELS,
  EVALUATION_DECISIONS,
  roundTo,
  scoreScaleOf,
  startupWeightingHint,
  STARTUP_SUBSCORES,
  type Checkin,
  type MetricKey,
  type StartupSubScore,
} from "@shared/types";
import { criterionLabel } from "@shared/presets/eventTemplates";
import {
  isPitchGrid,
  legacyPitchScores,
  pitchCriterionShortLabel,
  pitchGrid,
  pitchVerdicts,
  PITCH_CRITERIA_BY_FAMILY,
  PITCH_FAMILIES,
  PITCH_FAMILY_INFO,
} from "@shared/pitchGrid";
import { juryMeansOf } from "@shared/scoringRules";
import { STANDARD_METRICS, withUnit, type StandardMetricKey } from "@shared/presets/standardMetrics";
import { useBatch } from "@/context/BatchContext";
import { useCohort } from "@/context/CohortContext";
import { useEvents } from "@/context/EventsContext";
import { useLeaderboards } from "@/context/LeaderboardsContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartup } from "@/context/StartupContext";
import { formatDay, integer, percent, scoreSourceLine } from "@/lib/format";
import { paths } from "@/lib/paths";
import { Field } from "@/components/ui/Field";
import { ExternalLinkRow, Row, RowList } from "@/components/ui/Rows";
import { Section, SubsectionTitle } from "@/components/ui/Section";
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

/** Le score (sur 100, ou sur 10 pour Spring 2026) et ses quatre sous-scores, chacun avec sa source. */
export function StartupScoreSection() {
  const { startup, signals } = useStartup();
  const { startupScores, startupScoreOf } = useCohort();
  const score = startupScores.get(startup.id);
  if (!score) return null;
  const scale = scoreScaleOf(score);

  return (
    <Section title="Score" hint={`Data completeness ${percent(score.dataCompleteness)}.`}>
      <ScoreHeadline label="Overall" value={startupScoreOf(startup.id)} scale={scale} hint={startupWeightingHint(score)} />
      <Stack gap="md" mt="xs">
        {STARTUP_SUBSCORES.map((key) => {
          const source = scoreSourceLine(signals?.signals[key], scale);
          return (
            <ScoreBar
              key={key}
              label={SUBSCORE_LABEL[key]}
              value={score.subScores[key]}
              scale={scale}
              detail={
                source && (
                  <Text size="xs" c="dimmed" className="num">
                    {source}
                  </Text>
                )
              }
            />
          );
        })}
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

type SessionEvaluation = ReturnType<typeof useStartup>["evaluations"][number];

const one = (v: number) => roundTo(v, 1).toFixed(1);

/** Une ligne critere : libelle, segments sur 5, moyenne des jures. */
function CriterionLine({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="sm" c="dimmed" truncate>
        {label}
        {hint && <Text span size="xs" c="dark.2">{` · ${hint}`}</Text>}
      </Text>
      <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
        <RatingDots value={value} max={5} color="orange.5" />
        <Text size="xs" className="num" w={22} ta="right">
          {value === null ? "-" : one(value)}
        </Text>
      </Group>
    </Group>
  );
}

/** Ce que les jures ont repondu apres la grille Pitch : « Overall 3.8/5 · Go 2 · Would invest 2/3 · Bet 3.5/5 ». */
function verdictLine(evals: readonly SessionEvaluation[]): string | null {
  const v = pitchVerdicts(evals);
  const parts = [
    v.overall !== null ? `Overall ${one(v.overall)}/5` : null,
    ...EVALUATION_DECISIONS.flatMap((d) => (v.decisions[d] ? [`${EVALUATION_DECISION_LABELS[d]} ${v.decisions[d]}`] : [])),
    v.wouldInvest.answered ? `Would invest ${v.wouldInvest.yes}/${v.wouldInvest.answered}` : null,
    v.betLikelihood !== null ? `Bet ${one(v.betLikelihood)}/5` : null,
  ];
  return parts.filter(Boolean).join(" · ") || null;
}

/** Une seance notee sur la grille Pitch (lot 5) : la note sur 100, puis chaque famille (points) et ses criteres. */
function PitchGridSession({ evals, means, outstanding }: { evals: readonly SessionEvaluation[]; means: Record<string, number>; outstanding: boolean }) {
  const grid = pitchGrid(means, outstanding);
  const verdicts = verdictLine(evals);
  return (
    <Stack gap={6}>
      {grid.total !== null && (
        <Text size="sm" className="num">
          {`Grid ${one(grid.total)}/100${grid.outstanding ? " · Outstanding" : ""} · ${evals.length} ${evals.length === 1 ? "juror" : "jurors"}`}
        </Text>
      )}
      {PITCH_FAMILIES.map((family) => {
        const info = PITCH_FAMILY_INFO[family];
        const value = grid.families[family];
        return (
          <Stack key={family} gap={4} mt={4}>
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Text size="sm" fw={600}>
                {info.label}
              </Text>
              <Text size="sm" className="num">
                {value === null ? "-" : `${one((value / 100) * info.points)} / ${info.points}`}
              </Text>
            </Group>
            {PITCH_CRITERIA_BY_FAMILY[family].map((c) => (
              <CriterionLine key={c.key} label={pitchCriterionShortLabel(c)} hint={`${c.points} pts`} value={means[c.key] ?? null} />
            ))}
          </Stack>
        );
      })}
      {verdicts && (
        <Text size="sm" c="dimmed" className="num" mt={4}>
          {verdicts}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Notes des pitchs (staff et IC) : radar de la derniere seance, puis chaque seance. Une seance notee sur la
 * grille Pitch (lot 5) montre ses trois familles et ses neuf criteres ; une seance de Spring 2026, critere par
 * critere sur 5, comme avant. Le radar compare les deux : les familles sur 5, sous les cles de Spring 2026.
 */
export function PitchEvaluations() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { startup, evaluations } = useStartup();
  const { eventsById } = useEvents();
  const { leaderboardsByEventId } = useLeaderboards();
  if (evaluations.length === 0) return null;

  // Chaque seance : ses criteres notes (la grille vit dans le formulaire de jury, SPECS §2), sur 5, et la moyenne
  // des jures sur chacun ; `isGrid` : la grille Pitch.
  const sessions = [...new Set(evaluations.map((e) => e.parentId))]
    .flatMap((eventId) => {
      const event = eventsById.get(eventId);
      if (!event) return [];
      const evals = evaluations.filter((e) => e.parentId === eventId);
      const keys = [...new Set(evals.flatMap((e) => Object.keys(e.scores)))];
      return [{ event, evals, keys, means: juryMeansOf(evals, keys), isGrid: isPitchGrid(keys) }];
    })
    .sort((a, b) => b.event.startDateISOString.localeCompare(a.event.startDateISOString));
  const latest = sessions[0];
  // Le radar compare a Spring 2026 : la grille Pitch par familles, sur 5, sous les anciennes cles.
  const radarAxes = ({ keys, means, isGrid }: (typeof sessions)[number]) => {
    if (!isGrid) return keys.map((key) => ({ label: criterionLabel(key).split(/[ /]/)[0], value: means[key] ?? null }));
    const legacy = legacyPitchScores(means);
    return PITCH_FAMILIES.map((f) => ({ label: PITCH_FAMILY_INFO[f].legacyLabel.split(" ")[0], value: legacy[PITCH_FAMILY_INFO[f].legacyKey] ?? null }));
  };

  return (
    <Section title="Pitches" hint="Jury scores out of 5, per criterion. Pitch grid out of 100: Team 40, Speed of execution 40, Market 20.">
      {latest && (
        <ChartCard title={`Latest · ${latest.event.name}`}>
          <ScoreRadar axes={radarAxes(latest)} max={5} color="orange.5" h={200} />
        </ChartCard>
      )}
      <Stack gap="lg" mt="xs">
        {sessions.map(({ event, evals, keys, means, isGrid }) => {
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
              {isGrid ? (
                <PitchGridSession evals={evals} means={means} outstanding={row?.outstanding === true} />
              ) : (
                <Stack gap={6}>
                  {keys.map((key) => (
                    <CriterionLine key={key} label={criterionLabel(key)} value={means[key] ?? null} />
                  ))}
                </Stack>
              )}
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
          <SubsectionTitle>Competitors · {market.competitors.length}</SubsectionTitle>
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
          <SubsectionTitle>Sources</SubsectionTitle>
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
