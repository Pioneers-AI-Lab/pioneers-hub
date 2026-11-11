"use client";

import { Box, Group, Stack, Text } from "@mantine/core";
import { EVENT_KIND_FEATURES } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { useLeaderboards } from "@/context/LeaderboardsContext";
import { useProgram } from "@/context/ProgramContext";
import { formatDay } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { Empty, Section } from "@/components/ui/Section";

// Scores du jury uniquement (les avis entre pairs n'y entrent jamais), sur 10.
export default function LeaderboardPage() {
  const { program } = useProgram();
  const { batch, viewerFounderId } = useBatch();
  const { events, isLoading: isEventsLoading } = useEvents();
  const { leaderboardsByEventId, isHidden, isLoading } = useLeaderboards();

  const ranked = events.filter((e) => EVENT_KIND_FEATURES[e.kind].leaderboard).reverse();
  const back = { href: paths.batch(program.id, batch.id), label: "Home" };

  if (isHidden) {
    return (
      <>
        <PageHeader back={back} title="Leaderboard" />
        <Empty>The leaderboard is hidden during the mutual picks. It comes back once the teams are formed.</Empty>
      </>
    );
  }
  if (isLoading || isEventsLoading) return <PageLoader />;

  return (
    <>
      <PageHeader back={back} title="Leaderboard" subtitle="Jury scores out of 10" />
      {ranked.length === 0 && <Empty>No scored event yet.</Empty>}
      {ranked.map((event) => {
        const board = leaderboardsByEventId.get(event.id);
        return (
          <Section key={event.id} title={`${event.name} · ${formatDay(event.startDateISOString.slice(0, 10), true)}`}>
            {!board || board.rows.length === 0 ? (
              <Empty>No scores yet.</Empty>
            ) : (
              <Stack gap={0}>
                {[...board.rows]
                  .sort((a, b) => a.rank - b.rank)
                  .map((row) => {
                    const isMine = viewerFounderId !== null && row.memberIds.includes(viewerFounderId);
                    return (
                      <Group key={row.targetId} className="row" wrap="nowrap" gap="md">
                        <Text className="num" fw={600} w={28} c={row.rank <= 3 ? "pioneers" : "dimmed"}>
                          {row.rank}
                        </Text>
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text fw={500} truncate c={isMine ? "pioneers" : undefined}>
                            {row.name}
                          </Text>
                          <Text size="xs" c="dimmed" className="num">
                            {row.evaluationsCount} {row.evaluationsCount === 1 ? "review" : "reviews"}
                          </Text>
                        </Box>
                        <Text className="num" fw={600} fz="lg">
                          {row.score.toFixed(1)}
                        </Text>
                      </Group>
                    );
                  })}
              </Stack>
            )}
          </Section>
        );
      })}
    </>
  );
}
