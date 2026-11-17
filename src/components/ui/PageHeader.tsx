"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button, Group, Stack, Text, Title, type MantineSpacing } from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";
import { useHelpToggle } from "./Help";

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

/**
 * Titre de page, precede au besoin du bouton de retour (`back`). Sous le titre, comme
 * `Section` : `subtitle`, ce qui reste visible (un etat, une donnee : date, statut), puis
 * `help`, l'explication de la page, repliee derriere un (?) a droite du titre (UI-RULES §10).
 */
export function PageHeader({
  title,
  subtitle,
  help,
  back,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  help?: ReactNode;
  back?: { href: string; label: string };
  right?: ReactNode;
}) {
  const { isOpen: isHelpOpen, toggle } = useHelpToggle(title);
  return (
    <Stack gap="xs" mb="md">
      {back && <BackButton {...back} />}
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={0} wrap="nowrap" align="center">
            <Title order={2} style={{ overflowWrap: "anywhere" }}>
              {title}
            </Title>
            {help && toggle}
          </Group>
          {subtitle && (
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          )}
          {help && isHelpOpen && (
            <Text size="sm" c="dimmed">
              {help}
            </Text>
          )}
        </Stack>
        {right}
      </Group>
    </Stack>
  );
}
