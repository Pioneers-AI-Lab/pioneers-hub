"use client";

import { AreaChart } from "@mantine/charts";
import { Stack, Text } from "@mantine/core";
import { CHART_COLORS } from "./ChartCard";

// ----------------------------
// Courbe d'un indicateur (fiche startup, « Traction » : Total users, Total revenue)
// ----------------------------
// Le titre, la derniere valeur en grand, puis la courbe semaine par semaine :
// trait de 2 px, degrade sous la courbe, un point par semaine, axe des valeurs
// a droite avec trois graduations, comme la reference.

export type MetricPoint = { label: string; value: number };

/** Graduation abregee de l'axe : `100k`, `1.2M` (le prefixe d'unite est garde : `€100k`). */
function compactTick(v: number, prefix: string) {
  const abs = Math.abs(v);
  const n = abs >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : abs >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : `${+v.toFixed(1)}`;
  return `${prefix}${n}`;
}

export function MetricAreaChart({
  title,
  points,
  format = (v) => String(v),
  unitPrefix = "",
  color = CHART_COLORS.primary,
  h = 110,
}: {
  title: string;
  points: MetricPoint[];
  format?: (v: number) => string;
  /** Prefixe des graduations abregees (`€`). */
  unitPrefix?: string;
  color?: string;
  h?: number;
}) {
  if (points.length === 0) return null;
  const last = points[points.length - 1].value;
  // Une seule semaine : pas de courbe, la valeur et sa semaine.
  if (points.length < 2) {
    return (
      <Stack gap={4}>
        <Text size="sm" c="dimmed">
          {title}
        </Text>
        <Text fz={28} fw={700} c={color} className="num" lh={1.1}>
          {format(last)}
        </Text>
        <Text size="xs" c="dimmed">
          {points[0].label} · one week of data
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Text size="sm" c="dimmed">
        {title}
      </Text>
      <Text fz={28} fw={700} c={color} className="num" lh={1.1}>
        {format(last)}
      </Text>
      <AreaChart
        h={h}
        mt="xs"
        data={points}
        dataKey="label"
        series={[{ name: "value", label: title, color }]}
        curveType="linear"
        strokeWidth={2}
        withGradient
        fillOpacity={0.35}
        withDots
        dotProps={{ r: 3, strokeWidth: 2 }}
        activeDotProps={{ r: 4, strokeWidth: 2 }}
        gridAxis="none"
        tickLine="none"
        gridColor={CHART_COLORS.grid}
        textColor={CHART_COLORS.text}
        yAxisProps={{
          orientation: "right",
          width: 46,
          tickCount: 3,
          domain: [0, "auto"],
          fontSize: 11,
          tickFormatter: (v: number) => compactTick(v, unitPrefix),
        }}
        xAxisProps={{ fontSize: 11, interval: "preserveStartEnd", padding: { left: 6, right: 6 } }}
        valueFormatter={format}
      />
    </Stack>
  );
}
