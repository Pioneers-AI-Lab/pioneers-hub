import { Group, Progress, Stack, Text } from "@mantine/core";

/**
 * Une repartition en barres horizontales (remplace les camemberts du
 * dashboard : lisible sur mobile, sans bibliotheque de graphiques).
 */
export function Distribution({
  counts,
  total,
  labels,
  limit = 8,
}: {
  counts: Record<string, number>;
  /** Base des pourcentages ; par defaut la somme. */
  total?: number;
  labels?: Record<string, string>;
  limit?: number;
}) {
  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  const base = total ?? entries.reduce((sum, [, n]) => sum + n, 0);
  if (entries.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        -
      </Text>
    );
  }
  return (
    <Stack gap={10}>
      {entries.map(([key, n]) => (
        <Stack key={key} gap={4}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="sm" truncate>
              {labels?.[key] ?? key}
            </Text>
            <Text size="sm" c="dimmed" className="num" style={{ flexShrink: 0 }}>
              {n}
              {base > 0 ? ` · ${Math.round((n / base) * 100)}%` : ""}
            </Text>
          </Group>
          <Progress value={base > 0 ? (n / base) * 100 : 0} size={4} radius="xl" color="pioneers" bg="dark.5" />
        </Stack>
      ))}
    </Stack>
  );
}
