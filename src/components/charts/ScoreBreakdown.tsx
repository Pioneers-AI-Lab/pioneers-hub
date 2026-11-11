"use client";

import { useState, type ReactNode } from "react";
import { Box, Collapse, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { score10 } from "@/lib/format";
import { CHART_COLORS } from "./ChartCard";

// ----------------------------
// Detail d'un score (fiche fondateur, « Score breakdown — click to expand »)
// ----------------------------
// Une ligne par composante : initiale, nom, poids, valeur sur 10, mini barre.
// Un appui deplie les signaux qui l'expliquent. Sans fleche (pas d'icone) : la
// ligne entiere est le bouton, « Hide » / « Details » le dit en texte.

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

export function ScoreBreakdown({ rows }: { rows: BreakdownRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
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
                <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>
                  {r.label}
                </Text>
                <Text size="xs" c="dimmed" className="num" visibleFrom="xs">
                  {Math.round(r.weight * 100)}%
                </Text>
                <Text size="sm" fw={700} c={r.value === null ? "dimmed" : "pioneers"} className="num" w={34} ta="right">
                  {score10(r.value)}
                </Text>
                <Box w={56} h={5} bg={CHART_COLORS.track} style={{ borderRadius: 99, overflow: "hidden", flexShrink: 0 }}>
                  <Box h="100%" w={`${(r.value ?? 0) * 10}%`} bg={CHART_COLORS.primary} style={{ borderRadius: 99 }} />
                </Box>
                {canOpen && (
                  <Text size="xs" c="dimmed" w={44} ta="right">
                    {isOpen ? "Hide" : "Details"}
                  </Text>
                )}
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
