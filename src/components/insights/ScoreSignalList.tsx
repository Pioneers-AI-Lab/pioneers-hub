"use client";

import { Group, Stack, Text } from "@mantine/core";
import { plainSignalLabel } from "@shared/scoreLabels";
import type { ScoreScale, ScoreSignal } from "@shared/types";
import { formatScore } from "@/lib/format";

// ----------------------------
// Les signaux d'un sous-score (fiche fondateur, fiche startup)
// ----------------------------
// Staff et investors : le libelle du calcul et la donnee brute (« Attendance (5) », « 80% (4/5 mandatory) »),
// et « not counted » pour un signal a 0 % (suivi). Fondateurs (decision du 18/11) : une phrase simple et
// la note du signal (shared/scoreLabels.ts). Partage d'AFFICHAGE : `scoreSignals` est en open data.

/** `detailed` : la vue du staff et des investors (`shared/access.ts#canSeeScoreDetails`). */
export function ScoreSignalList({ signals, scale, detailed }: { signals: readonly ScoreSignal[]; scale: ScoreScale; detailed: boolean }) {
  return (
    <Stack gap={2}>
      {signals.map((sig) => (
        <Group key={sig.label} justify="space-between" gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed" truncate>
            {detailed ? sig.label : plainSignalLabel(sig.label)}
            {detailed && sig.weight === 0 && " (not counted)"}
          </Text>
          <Text size="xs" className="num" style={{ flexShrink: 0 }}>
            {detailed ? sig.raw : formatScore(sig.score, scale)}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}
