import { Group, Text } from "@mantine/core";

/** Une liste de valeurs courtes (competences, secteurs) en etiquettes sobres. */
export function Tags({ values }: { values: readonly string[] | null | undefined }) {
  if (!values || values.length === 0) return <Text size="sm">-</Text>;
  return (
    <Group gap={6}>
      {values.map((v) => (
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
    </Group>
  );
}
