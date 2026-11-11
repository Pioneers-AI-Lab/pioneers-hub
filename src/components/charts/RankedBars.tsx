import { Box, Group, Stack, Text } from "@mantine/core";
import { CHART_COLORS } from "./ChartCard";

// ----------------------------
// Barres classees (dashboard Spring 2026 : competences ; maquette : concurrence)
// ----------------------------
// Une ligne par valeur : la barre a gauche, le libelle, l'effectif a droite,
// la plus grande valeur fait toute la largeur. `color` par ligne pour les
// categories de la maquette (grandes, moyennes, petites entreprises).

export type RankedBar = { key: string; label: string; value: number; color?: string };

const cssColor = (c: string) => `var(--mantine-color-${c.replace(".", "-")})`;

export function RankedBars({
  bars,
  limit = 8,
  max,
  sorted = true,
}: {
  bars: RankedBar[];
  limit?: number;
  max?: number;
  /** `false` garde l'ordre donne (categories de taille de la maquette). */
  sorted?: boolean;
}) {
  const rows = (sorted ? [...bars].sort((a, b) => b.value - a.value) : bars).slice(0, limit);
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return null;

  return (
    <Stack gap={10}>
      {rows.map((r) => (
        <Group key={r.key} gap="sm" wrap="nowrap">
          <Box w="38%" h={5} bg={CHART_COLORS.track} style={{ borderRadius: 99, flexShrink: 0, overflow: "hidden" }}>
            <Box h="100%" w={`${(r.value / top) * 100}%`} style={{ borderRadius: 99, background: cssColor(r.color ?? CHART_COLORS.primary) }} />
          </Box>
          <Text size="sm" c="dimmed" style={{ flex: 1, minWidth: 0 }} truncate ta="right">
            {r.label}
          </Text>
          <Text size="sm" fw={600} className="num" w={28} ta="right" style={{ flexShrink: 0 }}>
            {r.value}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}
