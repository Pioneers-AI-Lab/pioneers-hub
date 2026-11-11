import Link from "next/link";
import type { ReactNode } from "react";
import { Paper, SimpleGrid, Text } from "@mantine/core";

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
    <Paper component={Link} href={href} withBorder p="md" radius="md" bg="dark.6" style={{ textDecoration: "none", color: "inherit" }}>
      {body}
    </Paper>
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
