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
// Une ligne par composante : initiale, nom, poids, valeur sur son echelle, mini barre.
// Un appui deplie les signaux qui l'expliquent : la ligne entiere est
// le bouton, un chevron `v` (retourne une fois ouvert) signale les lignes depliables.

export type BreakdownRow = {
  key: string;
  short: string;
  label: string;
  /** Poids dans le score global (0-1). */
  weight: number;
  value: number | null;
  /** Signaux affiches au depliage. */
  details?: ReactNode;
};

/** `detailed` (staff et investors, `shared/access.ts#canSeeScoreDetails`) : la colonne des poids et « (not counted) » sur une ligne a 0 %. */
export function ScoreBreakdown({ rows, scale, detailed }: { rows: BreakdownRow[]; scale: ScoreScale; detailed: boolean }) {
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
              py="xs"
              onClick={() => canOpen && setOpen(isOpen ? null : r.key)}
              aria-expanded={canOpen ? isOpen : undefined}
              style={{ cursor: canOpen ? "pointer" : "default" }}
            >
              <Group gap="sm" wrap="nowrap">
                <Text size="xs" c="dimmed" fw={600} w={22}>
                  {r.short}
                </Text>
                <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                  {r.label}
                  {detailed && r.weight === 0 && " (not counted)"}
                </Text>
                {detailed && (
                  <Text size="xs" c="dimmed" className="num" visibleFrom="xs">
                    {Math.round(r.weight * 100)}%
                  </Text>
                )}
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
                <Box pb="xs" pl={34}>
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
