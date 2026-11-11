"use client";

import { Sparkline } from "@mantine/charts";
import { Group, Stack, Text } from "@mantine/core";
import { CHART_COLORS } from "./ChartCard";

// ----------------------------
// Tendance compacte (maquette « Startups Overview », Traction : Interviews, Active users, MRR)
// ----------------------------
// Le libelle a gauche, la derniere valeur a droite (en couleur), une courbe
// sans axe, et les etiquettes de la premiere et de la derniere semaine.

export function TrendLine({
  label,
  points,
  format = (v) => String(v),
  color = CHART_COLORS.primary,
}: {
  label: string;
  points: { label: string; value: number }[];
  format?: (v: number) => string;
  color?: string;
}) {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm" c="dimmed">
          {label}
        </Text>
        <Text size="sm" fw={700} c={color} className="num">
          {format(last.value)}
        </Text>
      </Group>
      <Sparkline h={36} data={points.map((p) => p.value)} color={color} curveType="linear" strokeWidth={2} fillOpacity={0.25} withGradient />
      <Group justify="space-between" gap="xs">
        <Text fz={11} c="dimmed">
          {points[0].label}
        </Text>
        {points.length > 1 && (
          <Text fz={11} c="dimmed">
            {last.label}
          </Text>
        )}
      </Group>
    </Stack>
  );
}
