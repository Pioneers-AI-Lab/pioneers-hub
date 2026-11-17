"use client";

import { useState, type ReactNode } from "react";
import { Box, Collapse, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import type { ScoreScale } from "@shared/types";
import { formatScore, scoreFill } from "@/lib/format";
import { ExpandChevron } from "@/components/ui/Rows";
import { CHART_COLORS } from "./ChartCard";

// ----------------------------
// Detail d'un score (fiche fondateur, « Score breakdown — click to expand »)
// ----------------------------
// Une ligne par composante : initiale, nom, poids, valeur sur son echelle, mini barre ;
// sous le nom, d'ou vient la valeur (`source` : « Hackathons (3): 74 · Peer ratings (4): 63 »),
// toujours affiche. Un appui deplie les signaux qui l'expliquent : la ligne entiere est
// le bouton, un chevron (tourne vers le bas une fois ouvert) signale les lignes depliables.

export type BreakdownRow = {
  key: string;
  short: string;
  label: string;
  /** Poids dans le score global (0-1). */
  weight: number;
  value: number | null;
  /** D'ou vient la valeur, en une ligne sous le nom. */
  source?: string;
  /** Signaux affiches au depliage. */
  details?: ReactNode;
};

export function ScoreBreakdown({ rows, scale }: { rows: BreakdownRow[]; scale: ScoreScale }) {
  const [open, setOpen] = useState<string | null>(null);
  // Colonne du chevron reservee sur toutes les lignes des qu'une en a un : les valeurs restent alignees.
  const anyDetails = rows.some((r) => r.details);
  return (
    <Stack gap={0}>
      {rows.map((r) => {
        const isOpen = open === r.key;
        const canOpen = !!r.details;
        return (
          <Box key={r.key} style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
            <UnstyledButton
              w="100%"
              py={10}
              onClick={() => canOpen && setOpen(isOpen ? null : r.key)}
              aria-expanded={canOpen ? isOpen : undefined}
              style={{ cursor: canOpen ? "pointer" : "default" }}
            >
              <Group gap="sm" wrap="nowrap">
                <Text size="xs" c="dimmed" fw={600} w={22}>
                  {r.short}
                </Text>
                <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" truncate>
                    {r.label}
                  </Text>
                  {r.source && (
                    <Text size="xs" c="dimmed" className="num">
                      {r.source}
                    </Text>
                  )}
                </Stack>
                <Text size="xs" c="dimmed" className="num" visibleFrom="xs">
                  {Math.round(r.weight * 100)}%
                </Text>
                <Text size="sm" fw={700} c={r.value === null ? "dimmed" : "pioneers"} className="num" w={34} ta="right">
                  {formatScore(r.value, scale)}
                </Text>
                <Box w={56} h={5} bg={CHART_COLORS.track} style={{ borderRadius: 99, overflow: "hidden", flexShrink: 0 }}>
                  <Box h="100%" w={`${scoreFill(r.value, scale)}%`} bg={CHART_COLORS.primary} style={{ borderRadius: 99 }} />
                </Box>
                {anyDetails && <ExpandChevron expanded={isOpen} size={14} hidden={!canOpen} />}
              </Group>
            </UnstyledButton>
            {canOpen && (
              <Collapse expanded={isOpen}>
                <Box pb={10} pl={34}>
                  {r.details}
                </Box>
              </Collapse>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
