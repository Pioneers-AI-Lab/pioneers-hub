import type { ReactNode } from "react";
import { Group, Paper, Stack } from "@mantine/core";

// ----------------------------
// Le cadre commun des graphiques
// ----------------------------
// Reprend les cartes du dashboard Spring 2026 (fond legerement plus clair que
// la page, filet, coins arrondis) avec les jetons du theme : `dark.6` pour le
// fond, `dark.4` pour le filet, rayon `md`, etiquette `.label`.

export function ChartCard({ title, right, children }: { title?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="md" bg="dark.6">
      <Stack gap="sm">
        {(title || right) && (
          <Group justify="space-between" gap="xs" wrap="nowrap">
            {title && <span className="label">{title}</span>}
            {right}
          </Group>
        )}
        {children}
      </Stack>
    </Paper>
  );
}

/** Couleurs des graphiques : la marque d'abord, puis des teintes du theme. */
export const CHART_COLORS = {
  primary: "pioneers.6",
  primarySoft: "pioneers.9",
  muted: "dark.2",
  faint: "dark.3",
  track: "dark.5",
  grid: "dark.4",
  text: "dark.2",
  // TAM / SAM / SOM et categories de taille (reprise des teintes du dashboard).
  violet: "violet.5",
  teal: "teal.5",
  green: "green.5",
  orange: "orange.5",
  red: "red.5",
} as const;
