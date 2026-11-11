"use client";

import { useState } from "react";
import { Group, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { money, percent } from "@/lib/format";

// ----------------------------
// TAM / SAM / SOM en bulles (fiche startup, « Market »)
// ----------------------------
// Trois cercles dont l'AIRE suit la taille du marche (rayon en racine carree,
// borne pour rester lisible), teintes violette / bleue / verte comme la
// reference. Un appui (ou un clic) sur une bulle affiche son raisonnement
// dessous. Pas de logique au survol (mobile d'abord) : le survol n'ajoute qu'un
// retour visuel, en CSS, sur les ecrans qui survolent (`.bubble`, globals.css).

export type MarketSize = {
  key: "tam" | "sam" | "som";
  low: number | null;
  mid: number | null;
  high: number | null;
  reasoning: string | null;
};

const META = {
  tam: { label: "TAM", caption: "Total addressable", color: "violet" },
  sam: { label: "SAM", caption: "Serviceable", color: "pioneers" },
  som: { label: "SOM", caption: "3-5 year capture", color: "teal" },
} as const;

const MAX_D = 132;
const MIN_D = 76;

export function MarketBubbles({ sizes, cagr }: { sizes: MarketSize[]; cagr?: number | null }) {
  const [active, setActive] = useState<MarketSize["key"] | null>(null);
  const top = Math.max(1, ...sizes.map((s) => s.mid ?? 0));
  const diameter = (v: number | null) => (v ? Math.max(MIN_D, Math.sqrt(v / top) * MAX_D) : MIN_D);
  const current = sizes.find((s) => s.key === active);

  return (
    <Stack gap="md">
      <Group justify="space-around" align="flex-end" wrap="nowrap" gap="xs">
        {sizes.map((s) => {
          const meta = META[s.key];
          const d = diameter(s.mid);
          const isActive = active === s.key;
          return (
            <Stack key={s.key} align="center" gap={6} style={{ flex: 1, minWidth: 0 }}>
              <UnstyledButton
                className="bubble"
                onClick={() => setActive(isActive ? null : s.key)}
                aria-pressed={isActive}
                aria-label={`${meta.label} ${money(s.mid)}`}
                w={d}
                h={d}
                style={{
                  borderRadius: "50%",
                  border: `1px solid var(--mantine-color-${meta.color}-${isActive ? 4 : 7})`,
                  background: `color-mix(in srgb, var(--mantine-color-${meta.color}-9) ${isActive ? 45 : 28}%, transparent)`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  transition: "background 150ms ease, border-color 150ms ease",
                }}
              >
                <Text size="xs" fw={700} c={`${meta.color}.4`} lts={0.5}>
                  {meta.label}
                </Text>
                <Text fw={700} size={d > 110 ? "lg" : "sm"} c="white" className="num" lh={1.2}>
                  {money(s.mid)}
                </Text>
                {d > 96 && (
                  <Text fz={11} c="dimmed" className="num">
                    {money(s.low)} to {money(s.high)}
                  </Text>
                )}
                {s.key === "tam" && cagr !== null && cagr !== undefined && (
                  <Text fz={11} fw={700} c="teal.4" mt={2}>
                    {percent(cagr)} CAGR
                  </Text>
                )}
              </UnstyledButton>
              <Text size="xs" c="dimmed" ta="center">
                {meta.caption}
              </Text>
            </Stack>
          );
        })}
      </Group>
      <Paper radius="md" p="sm" bg="dark.7" withBorder mih={64}>
        {current?.reasoning ? (
          <Stack gap={4}>
            <Text size="xs" fw={700} c={`${META[current.key].color}.4`}>
              {META[current.key].label} · {money(current.low)} to {money(current.high)}
            </Text>
            <Text size="sm" c="dark.1">
              {current.reasoning}
            </Text>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            Tap a bubble to see the reasoning behind the market sizing.
          </Text>
        )}
      </Paper>
    </Stack>
  );
}
