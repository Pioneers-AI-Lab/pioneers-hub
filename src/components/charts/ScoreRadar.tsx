"use client";

import { RadarChart } from "@mantine/charts";
import { CHART_COLORS } from "./ChartCard";

// ----------------------------
// Radar de scores (fiche fondateur : 5 piliers ; maquette startups : 4 axes du pitch)
// ----------------------------
// Grille en filet du theme, polygone rempli a 25 % et souligne, un point par
// axe, comme la reference. L'echelle est fixe (0 -> `max`) : deux radars se
// comparent a l'oeil. Une valeur absente compte 0.

export type RadarAxis = { label: string; value: number | null };

export function ScoreRadar({
  axes,
  max = 10,
  color = CHART_COLORS.primary,
  h = 200,
}: {
  axes: RadarAxis[];
  max?: number;
  color?: string;
  h?: number;
}) {
  const data = axes.map((a) => ({ axis: a.label, score: a.value ?? 0 }));
  return (
    <RadarChart
      h={h}
      data={data}
      dataKey="axis"
      series={[{ name: "score", color, opacity: 0.25, strokeColor: color }]}
      gridColor={CHART_COLORS.grid}
      textColor={CHART_COLORS.text}
      withPolarRadiusAxis
      polarRadiusAxisProps={{ domain: [0, max], tick: false, axisLine: false, tickCount: 4 }}
      polarAngleAxisProps={{ fontSize: 11 }}
      withDots
      dotProps={{ r: 3, strokeWidth: 1.5 }}
      withTooltip={false}
    />
  );
}
