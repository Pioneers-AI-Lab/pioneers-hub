import type { ReactNode } from "react";
import { Group, Stack, Text } from "@mantine/core";

/** Un bloc de page : une etiquette discrete, puis le contenu. Pas de cadre. */
export function Section({
  id,
  title,
  right,
  hint,
  children,
}: {
  /** Ancre (`#id`) ; le defilement s'arrete sous l'en-tete fixe de l'AppShell. */
  id?: string;
  title: string;
  right?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack id={id} gap="xs" mt="lg" style={{ scrollMarginTop: "calc(var(--app-shell-header-offset, 0px) + 16px)" }}>
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
