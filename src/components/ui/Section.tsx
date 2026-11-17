"use client";

import type { ReactNode } from "react";
import { Group, Stack, Text, Title } from "@mantine/core";
import { useHelpToggle } from "./Help";

/**
 * Titre de section : Eina SemiBold, 16 px, bleu clair Pioneers (`pioneers.3` ;
 * le bleu vif reste celui de l'action). Seul, pour un titre ecrit a la main
 * (a cote d'un filtre, au-dessus d'une liste qui defile) ; `Section` le porte
 * deja. Les libelles de champ gardent `.label`.
 */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Title order={3} fz={16} lh={1.3} c="pioneers.3" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      {children}
    </Title>
  );
}

/**
 * Titre d'un bloc DANS une section (cadre de graphique, liste, classement) : un
 * niveau sous `SectionTitle`, meme famille, 14 px, couleur du texte. `accent` : le
 * bleu clair de `SectionTitle`, pour un sous-titre qui tient lieu de titre de section.
 */
export function SubsectionTitle({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <Title
      order={4}
      fz={14}
      lh={1.3}
      c={accent ? "pioneers.3" : undefined}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      {children}
    </Title>
  );
}

/**
 * Un bloc de page : un filet, un titre, puis le contenu. Pas de cadre.
 * Sous le titre : `hint`, ce qui reste visible, puis `help`, l'explication, repliee
 * derriere un (?) a droite du titre (components/ui/Help.tsx).
 */
export function Section({
  id,
  title,
  right,
  hint,
  help,
  children,
}: {
  /** Ancre (`#id`) ; le defilement s'arrete sous l'en-tete fixe de l'AppShell. */
  id?: string;
  title: string;
  right?: ReactNode;
  hint?: ReactNode;
  /** L'explication (pourquoi, comment, qui voit quoi) : repliee derriere le (?). */
  help?: ReactNode;
  children: ReactNode;
}) {
  const { isOpen: isHelpOpen, toggle } = useHelpToggle(title);
  return (
    <Stack id={id} gap="xs" className="section">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Group gap={0} wrap="nowrap" style={{ minWidth: 0 }}>
          <SectionTitle>{title}</SectionTitle>
          {help && toggle}
        </Group>
        {right}
      </Group>
      {hint && (
        <Text size="sm" c="dimmed">
          {hint}
        </Text>
      )}
      {help && isHelpOpen && (
        <Text size="sm" c="dimmed">
          {help}
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
