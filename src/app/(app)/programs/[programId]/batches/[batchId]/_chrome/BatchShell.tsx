"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Anchor, Box, Group, Text } from "@mantine/core";
import type { BatchRole } from "@shared/access";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { paths } from "@/lib/paths";

const ROLE_LABEL: Record<BatchRole, string | null> = {
  staff: "Staff",
  investor_ic: "Investor",
  investor_portfolio: "Investor",
  founder: null,
  public: null,
};

// ----------------------------
// La navigation d'un batch
// ----------------------------
// Mobile : barre d'onglets fixee en bas (a portee de pouce), texte seul.
// Tablette et ordinateur : la meme liste en onglets sous l'en-tete.
// Les onglets dependent du role : un fondateur a « To do » et « Me », le staff
// a « Staff ».
export function BatchShell({ children }: { children: ReactNode }) {
  const { program } = useProgram();
  const { batch, role } = useBatch();
  const pathname = usePathname();
  const base = paths.batch(program.id, batch.id);

  const tabs = [
    { label: "Home", href: base, exact: true },
    { label: "Founders", href: paths.founders(program.id, batch.id) },
    { label: "Startups", href: paths.startups(program.id, batch.id) },
    ...(role === "founder"
      ? [
          { label: "To do", href: paths.todo(program.id, batch.id) },
          { label: "Me", href: paths.me(program.id, batch.id) },
        ]
      : []),
    ...(role === "staff" ? [{ label: "Staff", href: paths.staff(program.id, batch.id) }] : []),
  ];
  const isActive = (tab: (typeof tabs)[number]) =>
    tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
  const roleLabel = ROLE_LABEL[role];

  return (
    <Box>
      <Group justify="space-between" gap="xs" mb="xs" wrap="nowrap">
        <Anchor component={Link} href={base} c="dimmed" size="sm" underline="never" truncate className="tap-link" style={{ display: "block", lineHeight: "20px" }}>
          {program.name} · <Text span c="white" inherit fw={500}>{batch.name}</Text>
        </Anchor>
        {roleLabel && (
          <Text size="xs" c="pioneers" fw={600} tt="uppercase" lts={0.6} style={{ flexShrink: 0 }}>
            {roleLabel}
          </Text>
        )}
      </Group>

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
