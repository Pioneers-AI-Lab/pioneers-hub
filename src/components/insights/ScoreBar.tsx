import type { ReactNode } from "react";
import { Box, Group, Progress, Stack, Text } from "@mantine/core";
import { score10 } from "@/lib/format";

/** Un sous-score sur 10 : libelle, barre, valeur. `detail` sous la ligne (signaux). */
export function ScoreBar({ label, value, detail }: { label: string; value: number | null; detail?: ReactNode }) {
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm">{label}</Text>
        <Text size="sm" fw={600} className="num" c={value === null ? "dimmed" : undefined}>
          {score10(value)}
        </Text>
      </Group>
      <Progress value={value === null ? 0 : value * 10} size={6} radius="xl" color="pioneers" bg="dark.5" />
      {detail && <Box>{detail}</Box>}
    </Stack>
  );
}

/** Le grand chiffre d'un score sur 10, avec son libelle. */
export function ScoreHeadline({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <Stack gap={0}>
      <span className="label">{label}</span>
      <Group gap={4} align="baseline">
        <Text fz={34} fw={700} className="num" c={value === null ? "dimmed" : "pioneers"} lh={1.1}>
          {score10(value)}
        </Text>
        <Text size="sm" c="dimmed">
          / 10
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
