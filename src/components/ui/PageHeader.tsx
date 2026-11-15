import Link from "next/link";
import type { ReactNode } from "react";
import { Button, Group, Stack, Text, Title, type MantineSpacing } from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";

/**
 * Retour vers la page parente : un vrai bouton (fond gris leger, chevron), 40 px
 * de haut. Remplace le fil d'Ariane sur mobile : un seul retour, vers le parent.
 */
export function BackButton({ href, label, mb }: { href: string; label: string; mb?: MantineSpacing }) {
  return (
    <Button
      component={Link}
      href={href}
      variant="light"
      color="gray"
      size="sm"
      h={40}
      pl={8}
      w="fit-content"
      maw="100%"
      mb={mb}
      leftSection={<IconChevronLeft size={18} stroke={2} />}
      styles={{ section: { marginInlineEnd: 4 } }}
    >
      {label}
    </Button>
  );
}

/** Titre de page, precede au besoin du bouton de retour (`back`). */
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
    <Stack gap={10} mb="md">
      {back && <BackButton {...back} />}
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
