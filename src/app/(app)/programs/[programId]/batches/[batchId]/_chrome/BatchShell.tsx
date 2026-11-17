"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Anchor, Box, Group, Text } from "@mantine/core";
import { isInvestor } from "@shared/access";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { formatPeriod } from "@/lib/format";
import { SHOW_STARTUPS_TAB } from "@/lib/features";
import { paths } from "@/lib/paths";
import { ViewAsFounderPicker, ViewAsSwitch } from "./ViewAsSwitch";

// ----------------------------
// La navigation d'un batch
// ----------------------------
// Mobile : barre d'onglets fixee en bas (a portee de pouce), texte seul.
// Tablette et ordinateur : la meme liste en onglets sous l'en-tete.
// « Startups » est masque derriere un drapeau (lib/features.ts).
// Les onglets dependent du role : un fondateur a « To do » et « Me ». Les outils
// du staff sont tous dans /admin (menu du compte), pas sous un batch. Un staff a, a
// la place de son etiquette de role, le « View as » (ViewAsSwitch).
// Pas de titre de page sous les onglets : l'onglet actif le dit deja. Le nom et
// les dates du batch sont dans la ligne du haut, pour tous les onglets.
/** Rembourrage vertical d'un lien du fil d'Ariane : avec le texte, une cible de 40 px. */
const CRUMB_PAD = 11;

/** Un lien du fil d'Ariane : en ligne (pas l'inline-flex de `tap-link`) pour que la ligne se tronque ; souligne au survol (ecran a pointeur) ou a l'appui (tactile), regle de Mantine. */
function Crumb({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Anchor component={Link} href={href} c="dimmed" inherit underline="hover" className="tap-link" style={{ display: "inline", paddingBlock: CRUMB_PAD }}>
      {children}
    </Anchor>
  );
}

export function BatchShell({ children }: { children: ReactNode }) {
  const { program } = useProgram();
  const { batch, role, viewerFounderId, canViewAs } = useBatch();
  const pathname = usePathname();
  const base = paths.batch(program.id, batch.id);

  const tabs = [
    { label: "Home", href: base, exact: true },
    { label: "Founders", href: paths.founders(program.id, batch.id) },
    ...(SHOW_STARTUPS_TAB ? [{ label: "Startups", href: paths.startups(program.id, batch.id) }] : []),
    { label: "Calendar", href: paths.calendar(program.id, batch.id) },
    ...(role === "founder"
      ? [
          { label: "To do", href: paths.todo(program.id, batch.id) },
          // « Me » : sa propre fiche, la meme page que celle des autres fondateurs.
          { label: "Me", href: viewerFounderId ? paths.founder(program.id, batch.id, viewerFounderId) : paths.me(program.id, batch.id) },
        ]
      : []),
  ];
  const matches = (tab: (typeof tabs)[number]) =>
    tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
  // L'onglet le plus precis gagne : sa propre fiche (/founders/{moi}) est « Me », pas « Founders ».
  const activeHref = tabs.filter(matches).sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
  const isActive = (tab: (typeof tabs)[number]) => tab.href === activeHref;

  return (
    <Box>
      <Group justify="space-between" gap="xs" mb="xs" wrap="nowrap">
        {/* Fil d'Ariane : le programme (la liste de ses batchs), puis le batch (son accueil). La
            ligne se tronque (overflow cache) : son rembourrage garde aux liens leur cible de 40 px. */}
        <Text size="sm" c="dimmed" truncate style={{ minWidth: 0, lineHeight: "20px", paddingBlock: CRUMB_PAD, marginBlock: -CRUMB_PAD }}>
          <Crumb href={paths.program(program.id)}>{program.name}</Crumb>
          {" · "}
          <Crumb href={base}>
            <Text span c="white" inherit fw={500}>
              {batch.name}
            </Text>
            {/* Les dates, coupees sur mobile (« 30 Apr 2… »), ne s'y affichent pas : Calendar les porte. */}
            <Box component="span" className="num" visibleFrom="sm">
              {" · "}
              {formatPeriod(batch.startDayString, batch.endDayString)}
            </Box>
            {batch.status === "completed" ? " · Completed" : ""}
          </Crumb>
        </Text>
        {/* Le staff : son « View as » ; un investor : son etiquette ; un fondateur, rien. */}
        {canViewAs && <ViewAsSwitch />}
        {!canViewAs && isInvestor(role) && (
          <Text size="xs" c="pioneers" fw={600} tt="uppercase" lts={0.6} style={{ flexShrink: 0 }}>
            Investor
          </Text>
        )}
      </Group>
      {canViewAs && <ViewAsFounderPicker />}

      <Box component="nav" className="toptabs" visibleFrom="sm" mb="lg">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} data-active={isActive(tab)}>
            {tab.label}
          </Link>
        ))}
      </Box>

      <Box className="batch-content" pt={4}>
        {children}
      </Box>

      <Box component="nav" className="tabbar" hiddenFrom="sm" aria-label="Batch navigation">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} data-active={isActive(tab)}>
            {tab.label}
          </Link>
        ))}
      </Box>
    </Box>
  );
}
