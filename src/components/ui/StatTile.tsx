import Link from "next/link";
import type { ReactNode } from "react";
import { Paper, SimpleGrid, Text } from "@mantine/core";

/** Une carte cliquable (tuile, prochaine seance) : le cadre des tuiles, toute la carte est le lien. */
export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Paper component={Link} href={href} withBorder p="md" radius="md" bg="dark.6" style={{ textDecoration: "none", color: "inherit" }}>
      {children}
    </Paper>
  );
}

/** Un chiffre et son libelle. Lien optionnel vers la liste correspondante. */
export function StatTile({ label, value, href }: { label: string; value: ReactNode; href?: string }) {
  const body = (
    <>
      <span className="label">{label}</span>
      <Text fz={28} fw={600} className="num" lh={1.2} mt={4} c="white">
        {value}
      </Text>
    </>
  );
  return href ? (
    <CardLink href={href}>{body}</CardLink>
  ) : (
    <Paper withBorder p="md" radius="md" bg="dark.6">
      {body}
    </Paper>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <SimpleGrid cols={2} spacing="sm">
      {children}
    </SimpleGrid>
  );
}
