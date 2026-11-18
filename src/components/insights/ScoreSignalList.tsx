"use client";

import { Group, Stack, Text } from "@mantine/core";
import { isStaffOrInvestor } from "@shared/access";
import { plainSignalLabel } from "@shared/scoreLabels";
import type { ScoreScale, ScoreSignal } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { formatScore } from "@/lib/format";

// ----------------------------
// Les signaux d'un sous-score (fiche fondateur, fiche startup)
// ----------------------------
// Staff et investors : le libelle du calcul et la donnee brute (« Attendance (5) », « 80% (4/5 mandatory) »).
// Fondateurs (decision du 18/11) : une phrase simple et la note du signal (shared/scoreLabels.ts).
// Partage d'AFFICHAGE : `scoreSignals` est en open data, donnee brute comprise. Un signal a 0 % (suivi) est dit « not counted ».

export function ScoreSignalList({ signals, scale }: { signals: readonly ScoreSignal[]; scale: ScoreScale }) {
  const { role } = useBatch();
  const detailed = isStaffOrInvestor(role);
  return (
    <Stack gap={2}>
      {signals.map((sig) => (
        <Group key={sig.label} justify="space-between" gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed" truncate>
            {detailed ? sig.label : plainSignalLabel(sig.label)}
            {sig.weight === 0 && " (not counted)"}
          </Text>
          <Text size="xs" className="num" style={{ flexShrink: 0 }}>
            {detailed ? sig.raw : formatScore(sig.score, scale)}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}
