import { Group, Text } from "@mantine/core";

/**
 * Une liste de valeurs courtes (competences, secteurs) en etiquettes sobres.
 * `max` : au-dela, un compte (`+3`) remplace le reste (cartes de la grille).
 */
export function Tags({ values, max }: { values: readonly string[] | null | undefined; max?: number }) {
  if (!values || values.length === 0) return <Text size="sm">-</Text>;
  const shown = values.slice(0, max);
  const hidden = values.length - shown.length;
  return (
    <Group gap={6}>
      {shown.map((v) => (
        <Text
          key={v}
          span
          size="xs"
          px={8}
          py={3}
          style={{ border: "1px solid var(--mantine-color-dark-4)", borderRadius: 6, color: "var(--mantine-color-dark-1)" }}
        >
          {v}
        </Text>
      ))}
      {hidden > 0 && (
        <Text span size="xs" c="dimmed" className="num">
          +{hidden}
        </Text>
      )}
    </Group>
  );
}
