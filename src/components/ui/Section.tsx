import type { ReactNode } from "react";
import { Group, Stack, Text } from "@mantine/core";

/** Un bloc de page : une etiquette discrete, puis le contenu. Pas de cadre. */
export function Section({
  title,
  right,
  hint,
  children,
}: {
  title: string;
  right?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack gap="xs" mt="lg">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <span className="label">{title}</span>
        {right}
      </Group>
      {hint && (
        <Text size="sm" c="dimmed">
          {hint}
        </Text>
      )}
      {children}
    </Stack>
  );
}

/** Ce qui s'affiche a la place d'une liste vide. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" c="dimmed" py="sm">
      {children}
    </Text>
  );
}
