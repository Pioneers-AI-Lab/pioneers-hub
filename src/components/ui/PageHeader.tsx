import Link from "next/link";
import type { ReactNode } from "react";
import { Anchor, Group, Stack, Text, Title } from "@mantine/core";

/**
 * Titre de page. `back` remplace le fil d'Ariane : sur mobile, un seul lien
 * vers le parent, en texte (pas d'icone).
 */
export function PageHeader({
  title,
  subtitle,
  back,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  right?: ReactNode;
}) {
  return (
    <Stack gap={6} mb="md">
      {back && (
        <Anchor component={Link} href={back.href} size="sm" c="dimmed" w="fit-content">
          {back.label}
        </Anchor>
      )}
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Title order={2} style={{ overflowWrap: "anywhere" }}>
            {title}
          </Title>
          {subtitle && (
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          )}
        </Stack>
        {right}
      </Group>
    </Stack>
  );
}
