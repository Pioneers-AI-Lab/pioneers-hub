import type { ReactNode } from "react";
import { Group, Stack } from "@mantine/core";
import { SubsectionTitle } from "@/components/ui/Section";

// ----------------------------
// Le cadre commun des graphiques
// ----------------------------
// La surface commune des cartes (`.card`, globals.css : celle des tuiles et de
// l'annuaire), titre de sous-section (`SubsectionTitle` : la carte vit dans une `Section`).

export function ChartCard({ title, right, children }: { title?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="card card-pad">
      <Stack gap="sm">
        {(title || right) && (
          <Group justify="space-between" gap="xs" wrap="nowrap">
            {title && <SubsectionTitle>{title}</SubsectionTitle>}
            {right}
          </Group>
        )}
        {children}
      </Stack>
    </div>
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
