import Link from "next/link";
import type { ReactNode } from "react";
import { SimpleGrid, Text } from "@mantine/core";
import { NavChevron } from "./Rows";

/**
 * Une carte cliquable (tuile, prochaine seance) : toute la carte est le lien. `.card` : la
 * surface commune des cartes ; `state-layer` : ses etats (survol, appui) (globals.css) ;
 * `>` en haut a droite, comme au bout d'une ligne qui mene a une page (`.card-nav`).
 */
export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="card card-pad card-link card-nav state-layer">
      {children}
      <span className="card-nav-icon">
        <NavChevron />
      </span>
    </Link>
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
  // Meme boite, cliquable ou non : libelle et chiffre au meme endroit dans toutes les tuiles.
  return href ? (
    <CardLink href={href}>{body}</CardLink>
  ) : (
    <div className="card card-pad">{body}</div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <SimpleGrid cols={2} spacing="sm">
      {children}
    </SimpleGrid>
  );
}
