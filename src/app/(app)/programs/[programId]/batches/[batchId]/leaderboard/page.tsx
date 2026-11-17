"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Anchor, Avatar, Stack, Text } from "@mantine/core";
import { juryTargetOf } from "@shared/events";
import { scoringSummary } from "@shared/scoringRules";
import type { EvaluationTargetType, Leaderboard, LeaderboardRow } from "@shared/types";
import { isStaffOrInvestor } from "@shared/access";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { useFounders } from "@/context/FoundersContext";
import { useLeaderboards } from "@/context/LeaderboardsContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { formatDay } from "@/lib/format";
import { paths } from "@/lib/paths";
import { rankedRowText } from "@/components/leaderboard/rankedRowText";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { ButtonRow, LinkRow, RankNumber, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// Scores du jury (les avis entre pairs n'y entrent jamais), sur 100 avec un bareme ; ou, si
// l'evenement le choisit, la valeur d'une de ses metriques (`Leaderboard.metric`).
// Une ligne de pitch est une startup : elle mene a sa fiche. Une ligne d'epreuve
// est une equipe d'un jour, sans page : elle deplie ses membres, chacun vers sa fiche.
// Decision du 17/11 : les fondateurs (et le public) voient le top 3 de chaque
// evenement, le staff et les investors tout le classement ; plus de classement
// individuel sur l'ensemble des hackathons.
const PUBLIC_TOP = 3;

export default function LeaderboardPage() {
  const { program } = useProgram();
  const { batch, role } = useBatch();
  const { events, isLoading: isEventsLoading } = useEvents();
  const { leaderboardsByEventId, isHidden, isLoading } = useLeaderboards();
  const showAll = isStaffOrInvestor(role);

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
      <PageHeader back={back} title="Leaderboard" subtitle={showAll ? "Each event by its scoring" : "The top 3 of each event"} />
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
                ? `${board.published === false ? "Not published yet · " : ""}${scoringSummary(board.scoring)}`
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
                  .filter((row) => showAll || row.rank <= PUBLIC_TOP)
                  .sort((a, b) => a.rank - b.rank)
                  .map((row) => (
                    <RankedRow
                      key={row.targetId}
                      row={row}
                      board={board}
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

function RankedRow({ row, board, target }: { row: LeaderboardRow; board: Leaderboard; target: EvaluationTargetType | null }) {
  const { program } = useProgram();
  const { batch, viewerFounderId } = useBatch();
  const { startupsById } = useStartups();
  const { foundersById } = useFounders();
  const [isOpen, setIsOpen] = useState(false);

  const isMine = viewerFounderId !== null && row.memberIds.includes(viewerFounderId);
  const text = rankedRowText(board, row);
  const props = {
    leading: <RankNumber rank={row.rank} />,
    title: isMine ? <Text span c="pioneers" inherit>{row.name}</Text> : row.name,
    subtitle: text.subtitle,
    meta: (
      <Text className="num" fw={600} fz="lg">
        {text.value}
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
