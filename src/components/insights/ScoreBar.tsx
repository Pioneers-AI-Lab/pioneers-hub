import type { ReactNode } from "react";
import { Box, Group, Progress, Stack, Text } from "@mantine/core";
import type { ScoreScale } from "@shared/types";
import { formatScore, scoreFill } from "@/lib/format";

/** Un sous-score sur son echelle (100, ou 10 pour Spring 2026) : libelle, barre, valeur. `detail` sous la ligne (signaux). */
export function ScoreBar({ label, value, scale, detail }: { label: string; value: number | null; scale: ScoreScale; detail?: ReactNode }) {
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm">{label}</Text>
        <Text size="sm" fw={600} className="num" c={value === null ? "dimmed" : undefined}>
          {formatScore(value, scale)}
        </Text>
      </Group>
      <Progress value={scoreFill(value, scale)} size={6} radius="xl" color="pioneers" bg="dark.5" />
      {detail && <Box>{detail}</Box>}
    </Stack>
  );
}

/** Le grand chiffre d'un score sur son echelle, avec son libelle. */
export function ScoreHeadline({ label, value, scale, hint }: { label: string; value: number | null; scale: ScoreScale; hint?: string }) {
  return (
    <Stack gap={0}>
      <span className="label">{label}</span>
      <Group gap={4} align="baseline">
        <Text fz={34} fw={700} className="num" c={value === null ? "dimmed" : "pioneers"} lh={1.1}>
          {formatScore(value, scale)}
        </Text>
        <Text size="sm" c="dimmed">
          / {scale}
        </Text>
      </Group>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Stack>
  );
}
