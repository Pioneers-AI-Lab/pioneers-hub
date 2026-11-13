"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Anchor, Avatar, Stack, Text } from "@mantine/core";
import { juryTargetOf } from "@shared/events";
import type { EvaluationTargetType, EventMetric, LeaderboardRow } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { useFounders } from "@/context/FoundersContext";
import { useLeaderboards, type CumulativeRow } from "@/context/LeaderboardsContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { formatDay, integer, metricValue, score10 } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { ButtonRow, LinkRow, RankNumber, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// Scores du jury (les avis entre pairs n'y entrent jamais), sur 10 ; ou, si
// l'evenement le choisit, la valeur d'une de ses metriques (`Leaderboard.metric`).
// Une ligne de pitch est une startup : elle mene a sa fiche. Une ligne d'epreuve
// est une equipe d'un jour, sans page : elle deplie ses membres, chacun vers sa fiche.
export default function LeaderboardPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { events, isLoading: isEventsLoading } = useEvents();
  const { leaderboardsByEventId, cumulative, isHidden, isLoading } = useLeaderboards();

  // Un evenement classe : celui dont le leaderboard existe (un jury ou une metrique le classe, SPECS §2).
  const ranked = events.filter((e) => leaderboardsByEventId.has(e.id)).reverse();
  const back = { href: paths.batch(program.id, batch.id), label: "Home" };
  const isReady = !isLoading && !isEventsLoading;

  // Arrivee par `paths.leaderboard(..., eventId)` : l'ancre n'existe qu'une fois les donnees la.
  useEffect(() => {
    if (!isReady || !window.location.hash) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
  }, [isReady]);

  if (isHidden) {
    return (
      <>
        <PageHeader back={back} title="Leaderboard" />
        <Empty>The leaderboard is hidden during the mutual picks. It comes back once the teams are formed.</Empty>
      </>
    );
  }
  if (!isReady) return <PageLoader />;

  return (
    <>
      <PageHeader back={back} title="Leaderboard" subtitle="Each hackathon by its scoring, and the founders across hackathons" />
      {cumulative.length > 0 && (
        <Section title="Founders" hint="Across hackathons: each founder gets their team's score (best team = 100), summed.">
          <RowList>
            {cumulative.map((row) => (
              <CumulativeFounderRow key={row.founderId} row={row} />
            ))}
          </RowList>
        </Section>
      )}
      {ranked.length === 0 && <Empty>No scored event yet.</Empty>}
      {ranked.map((event) => {
        const board = leaderboardsByEventId.get(event.id);
        return (
          <Section
            key={event.id}
            id={event.id}
            title={`${event.name} · ${formatDay(event.startDateISOString.slice(0, 10), true)}`}
            hint={
              board?.scoring
                ? `${board.published === false ? "Not published yet · " : ""}Points: ${board.scoring.items.filter((i) => !i.tieBreakOnly).map((i) => i.label).join(", ")}`
                : board?.metric
                  ? `Ranked by ${board.metric.label.toLowerCase()}`
                  : undefined
            }
            right={
              <Anchor component={Link} href={paths.event(program.id, batch.id, event.id)} size="sm" className="tap-link">
                Event
              </Anchor>
            }
          >
            {!board || board.rows.length === 0 ? (
              <Empty>No scores yet.</Empty>
            ) : (
              <RowList>
                {[...board.rows]
                  .sort((a, b) => a.rank - b.rank)
                  .map((row) => (
                    <RankedRow
                      key={row.targetId}
                      row={row}
                      metric={board.metric ?? null}
                      target={juryTargetOf(event)}
                    />
                  ))}
              </RowList>
            )}
          </Section>
        );
      })}
    </>
  );
}

function RankedRow({ row, metric, target }: { row: LeaderboardRow; metric: EventMetric | null; target: EvaluationTargetType | null }) {
  const { program } = useProgram();
  const { batch, viewerFounderId } = useBatch();
  const { startupsById } = useStartups();
  const { foundersById } = useFounders();
  const [isOpen, setIsOpen] = useState(false);

  const isMine = viewerFounderId !== null && row.memberIds.includes(viewerFounderId);
  const props = {
    leading: <RankNumber rank={row.rank} />,
    title: isMine ? <Text span c="pioneers" inherit>{row.name}</Text> : row.name,
    subtitle:
      row.total !== undefined
        ? row.late
          ? "Late submission: 0"
          : `${Math.round(row.normalized ?? 0)} / 100`
        : metric
          ? metric.label
          : `${row.evaluationsCount} ${row.evaluationsCount === 1 ? "review" : "reviews"}`,
    meta: (
      <Text className="num" fw={600} fz="lg">
        {row.total !== undefined ? metricValue({ unit: "pts" }, row.total) : metric ? metricValue(metric, row.score) : score10(row.score)}
      </Text>
    ),
  };

  // Pitch : la cible est une startup du batch.
  if (target === "startup") {
    const startup = startupsById.get(row.targetId);
    return startup ? (
      <LinkRow
        href={paths.startup(program.id, batch.id, startup.id)}
        avatar={{ name: startup.name, photoUrl: startup.logoUrl }}
        {...props}
      />
    ) : (
      <Row {...props} />
    );
  }

  // Equipe d'epreuve : les membres que le visiteur peut lire (profils publics pour un visiteur sans compte).
  const members = row.memberIds.flatMap((id) => foundersById.get(id) ?? []);
  if (members.length === 0) return <Row {...props} />;
  return (
    <>
      <ButtonRow
        onClick={() => setIsOpen((v) => !v)}
        expanded={isOpen}
        {...props}
        leading={
          <>
            {props.leading}
            <Avatar.Group spacing={14} style={{ flexShrink: 0 }}>
              {members.slice(0, 3).map((f) => (
                <Avatar key={f.id} src={f.photoUrl} name={f.name} color="initials" size={32} radius="xl" />
              ))}
            </Avatar.Group>
          </>
        }
      />
      {isOpen && (
        <Stack gap={0} pl={36}>
          {members.map((f) => (
            <LinkRow
              key={f.id}
              href={paths.founder(program.id, batch.id, f.id)}
              avatar={{ name: f.name, photoUrl: f.photoUrl }}
              title={f.name}
              subtitle={f.startupId ? startupsById.get(f.startupId)?.name : undefined}
            />
          ))}
        </Stack>
      )}
    </>
  );
}

/** Un fondateur au classement cumule : vers sa fiche. */
function CumulativeFounderRow({ row }: { row: CumulativeRow }) {
  const { program } = useProgram();
  const { batch, viewerFounderId } = useBatch();
  const { foundersById } = useFounders();
  const founder = foundersById.get(row.founderId);
  const props = {
    leading: <RankNumber rank={row.rank} />,
    title: row.founderId === viewerFounderId ? <Text span c="pioneers" inherit>{founder?.name ?? "Founder"}</Text> : (founder?.name ?? "Founder"),
    subtitle: `${row.events} ${row.events === 1 ? "hackathon" : "hackathons"}`,
    meta: (
      <Text className="num" fw={600} fz="lg">
        {integer(row.total)}
      </Text>
    ),
  };
  return founder ? (
    <LinkRow href={paths.founder(program.id, batch.id, founder.id)} avatar={{ name: founder.name, photoUrl: founder.photoUrl }} {...props} />
  ) : (
    <Row {...props} />
  );
}
