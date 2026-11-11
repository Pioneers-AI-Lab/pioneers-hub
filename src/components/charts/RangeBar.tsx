import { Box, Group, Stack, Text } from "@mantine/core";
import { CHART_COLORS } from "./ChartCard";

// ----------------------------
// Fourchette bas -> haut avec la valeur centrale (maquette « Startups Overview », Market)
// ----------------------------
// Une piste, la bande de la fourchette, un repere sur la valeur centrale.
// Toutes les lignes d'un meme bloc partagent l'echelle (`scaleMax`) pour
// rester comparables (TAM, SAM, SOM).

export type Range = { label: string; low: number | null; mid: number | null; high: number | null };

export function RangeBar({
  range,
  scaleMax,
  format,
  color = CHART_COLORS.primary,
}: {
  range: Range;
  scaleMax: number;
  format: (v: number | null) => string;
  color?: string;
}) {
  const pos = (v: number | null) => (v === null || scaleMax <= 0 ? 0 : Math.min(100, (v / scaleMax) * 100));
  const low = pos(range.low ?? range.mid);
  const high = pos(range.high ?? range.mid);
  const mid = pos(range.mid);
  const css = `var(--mantine-color-${color.replace(".", "-")})`;

  return (
    <Stack gap={6}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm" c="dimmed">
          {range.label}
        </Text>
        <Text size="xs" c="dimmed" className="num" truncate>
          {format(range.low)} to {format(range.high)}{" "}
          <Text span fw={700} c="white" inherit>
            ({format(range.mid)})
          </Text>
        </Text>
      </Group>
      <Box pos="relative" h={8} bg={CHART_COLORS.track} style={{ borderRadius: 99 }}>
        <Box
          pos="absolute"
          top={0}
          h="100%"
          left={`${low}%`}
          w={`${Math.max(1.5, high - low)}%`}
          style={{ borderRadius: 99, background: `color-mix(in srgb, ${css} 35%, transparent)` }}
        />
        {range.mid !== null && (
          <Box pos="absolute" top={-2} h={12} w={3} left={`calc(${mid}% - 1.5px)`} style={{ borderRadius: 2, background: css }} />
        )}
      </Box>
    </Stack>
  );
}
