"use client";

import { DonutChart } from "@mantine/charts";
import { Box, Group, Stack, Text } from "@mantine/core";
import { CHART_COLORS } from "./ChartCard";

// ----------------------------
// Repartition des profils (dashboard Spring 2026, « Profile Distribution »)
// ----------------------------
// Un anneau et sa legende : pastille, nom, effectif. Tech en bleu Pioneers,
// les autres categories en teintes plus sourdes, comme la reference.

export type DonutSlice = { key: string; label: string; value: number };

const SLICE_COLORS = [CHART_COLORS.primary, CHART_COLORS.primarySoft, CHART_COLORS.faint, CHART_COLORS.muted];

export function ProfileDonut({ slices, size = 128 }: { slices: DonutSlice[]; size?: number }) {
  const data = slices
    .filter((s) => s.value > 0)
    .map((s, i) => ({ name: s.label, value: s.value, color: SLICE_COLORS[i % SLICE_COLORS.length] }));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  return (
    <Group gap="lg" wrap="nowrap" align="center">
      <DonutChart
        data={data}
        size={size}
        thickness={Math.round(size * 0.19)}
        strokeWidth={0}
        paddingAngle={0}
        startAngle={90}
        endAngle={-270}
        tooltipDataSource="segment"
        valueFormatter={(v) => `${v} (${Math.round((v / total) * 100)}%)`}
      />
      <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
        {data.map((d) => (
          <Group key={d.name} gap={8} wrap="nowrap">
            <Box w={10} h={10} style={{ borderRadius: "50%", flexShrink: 0, background: `var(--mantine-color-${d.color.replace(".", "-")})` }} />
            <Text size="sm" c="dimmed" style={{ flex: 1 }} truncate>
              {d.name}
            </Text>
            <Text size="sm" fw={600} className="num">
              {d.value}
            </Text>
          </Group>
        ))}
      </Stack>
    </Group>
  );
}
