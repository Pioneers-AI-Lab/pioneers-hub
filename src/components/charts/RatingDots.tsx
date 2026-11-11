import { Box, Group } from "@mantine/core";
import { CHART_COLORS } from "./ChartCard";

// ----------------------------
// Note sur 5 (maquette « Startups Overview » : etoiles des pitchs et des fondateurs)
// ----------------------------
// Cinq segments au lieu de cinq etoiles (regle du projet : pas d'icone sans
// necessite). Une demi-note remplit un demi-segment.

export function RatingDots({
  value,
  max = 5,
  color = CHART_COLORS.primary,
}: {
  value: number | null;
  max?: number;
  color?: string;
}) {
  const css = `var(--mantine-color-${color.replace(".", "-")})`;
  return (
    <Group gap={3} wrap="nowrap" aria-label={value === null ? "No rating" : `${value} out of ${max}`}>
      {Array.from({ length: max }, (_, i) => {
        const fill = value === null ? 0 : Math.max(0, Math.min(1, value - i));
        return (
          <Box key={i} w={14} h={6} bg={CHART_COLORS.track} style={{ borderRadius: 2, overflow: "hidden" }}>
            <Box h="100%" w={`${fill * 100}%`} style={{ background: css }} />
          </Box>
        );
      })}
    </Group>
  );
}
