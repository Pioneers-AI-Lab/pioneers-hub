"use client";

import { SegmentedControl, Stack, Text } from "@mantine/core";
import { EDGE_MAX_NOTE, edgeStatus } from "@shared/edge";
import type { FounderEdgeRating } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useAction } from "@/hooks/useAction";
import { saveEdge } from "@/lib/edgeAdmin";
import { formatDateTime, noteOptions } from "@/lib/format";

const NOTES = noteOptions(EDGE_MAX_NOTE);

/**
 * La note du staff sur l'Edge d'un fondateur (shared/edge.ts) : le texte qu'il a ecrit, puis 0 a 5,
 * enregistre au toucher. Admin > Edge et la section Internal de sa fiche. Sans texte : rien a noter.
 */
export function EdgeRating({ founderId, founderName, text, rating }: { founderId: string; founderName: string; text: string | null; rating: FounderEdgeRating | null }) {
  const { user } = useAuth();
  const { busy, run } = useAction();
  const status = edgeStatus(text, rating);
  if (status === "missing") {
    return (
      <Text size="sm" c="dimmed">
        No edge written yet.
      </Text>
    );
  }
  const save = (v: string) => {
    if (!user) return;
    void run(() => saveEdge(founderId, Number(v), text, user.id), `${founderName}: edge rated ${v}/${EDGE_MAX_NOTE}.`);
  };
  return (
    <Stack gap="xs">
      <Text style={{ whiteSpace: "pre-wrap" }}>{text}</Text>
      <SegmentedControl fullWidth data={NOTES} disabled={busy !== null} value={rating ? String(rating.score) : ""} onChange={save} />
      <Text size="sm" c="dimmed">
        {!rating
          ? "Not rated yet."
          : status === "rated"
            ? `Rated ${formatDateTime(rating.ratedDateISOString)}`
            : `Changed since the last rating (${rating.score}/${EDGE_MAX_NOTE}): rate it again.`}
      </Text>
    </Stack>
  );
}
