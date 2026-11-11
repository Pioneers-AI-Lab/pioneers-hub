"use client";

import { useState } from "react";
import { Box, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { FOUNDER_PILLARS, type AttendanceStatus, type CommitmentStatus, type FounderPillar } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useCohort } from "@/context/CohortContext";
import { useEvents } from "@/context/EventsContext";
import { useFounder } from "@/context/FounderContext";
import { useLeaderboards } from "@/context/LeaderboardsContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { formatDay, percent, score10 } from "@/lib/format";
import { paths } from "@/lib/paths";
import { Field, FieldGrid } from "@/components/ui/Field";
import { LinkRow, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { ScoreHeadline } from "@/components/insights/ScoreBar";
import { useFounderLinks } from "./FounderLink";
import { ChartCard } from "@/components/charts/ChartCard";
import { ScoreBreakdown } from "@/components/charts/ScoreBreakdown";
import { ScoreRadar } from "@/components/charts/ScoreRadar";

// ----------------------------
// La fiche fondateur, cote evaluation (dashboard Spring 2026)
// ----------------------------
// Chaque bloc ne s'affiche que si le role a lu ses donnees (FounderContext,
// CohortContext) : un fondateur voit ses equipes et ses semaines, jamais son
// score ni sa presence.

const PILLAR_LABEL: Record<FounderPillar, string> = {
  engagement: "Engagement",
  execution: "Execution",
  likability: "Likability",
  commitment: "Commitment",
  achievements: "Achievements",
};

/** Initiales des piliers sur le radar (comme la reference). */
const PILLAR_SHORT: Record<FounderPillar, string> = {
  engagement: "E",
  execution: "Ex",
  likability: "L",
  commitment: "C",
  achievements: "A",
};

/**
 * Program Performance (fiche fondateur du dashboard) : le score global, le
 * radar des cinq piliers, et le detail de chacun (poids, valeur, signaux).
 */
export function FounderPerformance() {
  const { founder, signals } = useFounder();
  const { founderScores, founderPerformance } = useCohort();
  const score = founderScores.get(founder.id);
  if (!score) return null;
  const weight = 1 / FOUNDER_PILLARS.length;

  return (
    <Section title="Program performance" hint={`Data completeness ${percent(score.dataCompleteness)}.`}>
      <ChartCard>
        <ScoreHeadline label="Overall" value={founderPerformance(founder.id)} hint="Average of the five pillars." />
        <ScoreRadar axes={FOUNDER_PILLARS.map((p) => ({ label: PILLAR_SHORT[p], value: score.subScores[p] }))} h={210} />
        <ScoreBreakdown
          rows={FOUNDER_PILLARS.map((p) => ({
            key: p,
            short: PILLAR_SHORT[p],
            label: PILLAR_LABEL[p],
            weight,
            value: score.subScores[p],
            details:
              (signals?.signals[p] ?? []).length > 0 ? (
                <Stack gap={2}>
                  {signals!.signals[p]!.map((sig) => (
                    <Group key={sig.label} justify="space-between" gap="xs" wrap="nowrap">
                      <Text size="xs" c="dimmed" truncate>
                        {sig.label}
                      </Text>
                      <Text size="xs" className="num" style={{ flexShrink: 0 }}>
                        {sig.raw}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              ) : undefined,
          }))}
        />
      </ChartCard>
    </Section>
  );
}

/** Equipes successives, avec le rang et le score de l'equipe a chaque epreuve. */
export function FounderTeams() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { teamMemberships, canSeeDirectory } = useFounder();
  const { eventsById } = useEvents();
  const { startupsById } = useStartups();
  const { leaderboardsByEventId } = useLeaderboards();
  if (!canSeeDirectory) return null;

  return (
    <Section title="Teams and results">
      {teamMemberships.length === 0 ? (
        <Empty>No team yet.</Empty>
      ) : (
        <RowList>
          {teamMemberships.map((m) => {
            if (m.kind === "startup") {
              const startup = startupsById.get(m.teamId);
              const props = {
                avatar: startup ? { name: startup.name, photoUrl: startup.logoUrl } : undefined,
                title: startup?.name ?? "Startup",
                subtitle: ["Startup", m.role].filter(Boolean).join(" · "),
                meta: <Text size="sm" c="dimmed">Since {formatDay(m.startDayString, true)}</Text>,
              };
              // Toute la ligne mene a la startup.
              return startup ? (
                <LinkRow key={m.id} href={paths.startup(program.id, batch.id, startup.id)} {...props} />
              ) : (
                <Row key={m.id} {...props} />
              );
            }
            const { eventId } = m;
            const event = eventId ? eventsById.get(eventId) : undefined;
            const rows = eventId ? leaderboardsByEventId.get(eventId)?.rows : undefined;
            const row = rows?.find((r) => r.targetId === m.teamId);
            const props = {
              title: event?.name ?? "Event",
              subtitle: [row?.name, m.role ? m.role.replace(/_/g, " ") : null, formatDay(m.startDayString, true)].filter(Boolean).join(" · "),
              meta: row ? (
                <Stack gap={0} align="flex-end">
                  <Text fw={600} className="num">
                    {score10(row.score)}
                  </Text>
                  <Text size="xs" c={row.rank <= 3 ? "pioneers" : "dimmed"} className="num">
                    #{row.rank} of {rows?.length}
                  </Text>
                </Stack>
              ) : undefined,
            };
            // Classee : toute la ligne mene au classement de l'epreuve.
            return row && eventId ? (
              <LinkRow key={m.id} href={paths.leaderboard(program.id, batch.id, eventId)} {...props} />
            ) : (
              <Row key={m.id} {...props} />
            );
          })}
        </RowList>
      )}
    </Section>
  );
}

const ATTENDANCE_STYLE: Record<AttendanceStatus, { label: string; color: string }> = {
  present: { label: "Present", color: "var(--mantine-color-pioneers-6)" },
  in_office: { label: "In office", color: "var(--mantine-color-teal-7)" },
  late: { label: "Late", color: "var(--mantine-color-yellow-7)" },
  absent: { label: "Absent", color: "var(--mantine-color-dark-5)" },
};

/** Presence : le taux, puis une case par seance (calendrier du dashboard). */
export function FounderAttendance() {
  const { stats, attendance } = useFounder();
  const { eventsById } = useEvents();
  // Mobile d'abord : le detail d'un jour s'obtient en touchant sa case (pas d'info-bulle au survol).
  const [picked, setPicked] = useState<string | null>(null);
  if (!stats && attendance.length === 0) return null;

  const days = attendance
    .map((a) => ({ a, event: eventsById.get(a.parentId) }))
    .filter((x) => x.event)
    .sort((x, y) => x.event!.startDateISOString.localeCompare(y.event!.startDateISOString));
  const counts = days.reduce<Record<string, number>>((acc, { a }) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }), {});

  return (
    <Section
      title="Attendance"
      hint={stats ? `${stats.attendance.attended} of ${stats.attendance.total} sessions · ${percent(stats.attendance.rate)}` : undefined}
    >
      {days.length > 0 && (
        <>
          <Group gap={6}>
            {days.map(({ a, event }) => (
              <UnstyledButton
                key={a.parentId}
                onClick={() => setPicked(picked === a.parentId ? null : a.parentId)}
                aria-label={`${formatDay(event!.startDateISOString.slice(0, 10))}: ${ATTENDANCE_STYLE[a.status].label}`}
                aria-pressed={picked === a.parentId}
                w={40}
                h={40}
                style={{
                  borderRadius: 8,
                  background: ATTENDANCE_STYLE[a.status].color,
                  outline: picked === a.parentId ? "2px solid var(--mantine-color-white)" : undefined,
                  outlineOffset: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text size="xs" fw={600} c={a.status === "absent" ? "dimmed" : "white"} className="num">
                  {event!.startDateISOString.slice(8, 10)}
                </Text>
              </UnstyledButton>
            ))}
          </Group>
          {(() => {
            const day = days.find((d) => d.a.parentId === picked);
            return day ? (
              <Text size="sm">
                {formatDay(day.event!.startDateISOString.slice(0, 10))}: <Text span fw={600} inherit>{ATTENDANCE_STYLE[day.a.status].label}</Text>
              </Text>
            ) : (
              <Text size="xs" c="dimmed">
                Tap a day for its status.
              </Text>
            );
          })()}
          <Group gap="md">
            {(Object.keys(ATTENDANCE_STYLE) as AttendanceStatus[])
              .filter((s) => counts[s])
              .map((s) => (
                <Group key={s} gap={6}>
                  <Box w={10} h={10} style={{ borderRadius: 3, background: ATTENDANCE_STYLE[s].color }} />
                  <Text size="xs" c="dimmed">
                    {ATTENDANCE_STYLE[s].label} <span className="num">{counts[s]}</span>
                  </Text>
                </Group>
              ))}
          </Group>
        </>
      )}
    </Section>
  );
}

/** Reseau : interet recu, donne, reciproque ; « je travaille avec ». */
export function FounderNetwork() {
  const { stats } = useFounder();
  const founderLinks = useFounderLinks();
  if (!stats) return null;

  return (
    <Section title="Network">
      <FieldGrid>
        <Field label="Interest received">
          <span className="num">{stats.interestIncoming.length}</span>
        </Field>
        <Field label="Interest given">
          <span className="num">{stats.interestOutgoing.length}</span>
        </Field>
        <Field label="Unique teammates">
          <span className="num">{stats.uniqueTeammates}</span>
        </Field>
        <Field label="Working with (mutual)">
          <span className="num">{stats.workingWithMutual.length}</span>
        </Field>
      </FieldGrid>
      <Stack gap="md" mt="xs">
        <Field label="Mutual interest">{founderLinks(stats.interestMutual)}</Field>
        <Field label="Working with">{founderLinks(stats.workingWithOutgoing)}</Field>
        <Field label="Interested in them">{founderLinks(stats.interestIncoming)}</Field>
      </Stack>
    </Section>
  );
}

const COMMITMENT_LABEL: Record<CommitmentStatus, string> = {
  committed: "Committed to a startup",
  on_a_project: "On a project, not committed",
  testing_relationships: "Testing relationships",
  what_am_i_doing_here: "What am I doing here?",
};

/** Formulaires de motivation et d'objectifs, semaine par semaine. */
export function FounderWeeks() {
  const { weeks, isSelf } = useFounder();
  const founderLinks = useFounderLinks();
  if (weeks.length === 0) return null;

  return (
    <Section title="Weekly check-ins" hint={isSelf ? "Only you and the Pioneers team see these." : undefined}>
      <Stack gap="lg">
        {weeks.map((w) => {
          return (
            <Stack key={w.id} gap="xs" pb="md" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
              <Group justify="space-between" gap="xs">
                <Text fw={600}>Week of {formatDay(w.weekStartDayString, true)}</Text>
                {w.commitmentStatus && (
                  <Text size="sm" c="pioneers">
                    {COMMITMENT_LABEL[w.commitmentStatus]}
                  </Text>
                )}
              </Group>
              <Field label="Project">{w.projectName}</Field>
              <Field label="Goal for the week">{w.goalForWeek}</Field>
              <Field label="Priority">{w.priorityForWeek}</Field>
              <Field label="Learnings">{w.learnings}</Field>
              <Field label="Interested in">{founderLinks(w.interestedInFounderIds)}</Field>
              <Field label="Working with">{founderLinks(w.workingWithFounderIds)}</Field>
              <Field label="How it feels">{w.feelingForWeek}</Field>
              <Field label="Anything specific">{w.anythingSpecific}</Field>
            </Stack>
          );
        })}
      </Stack>
    </Section>
  );
}
