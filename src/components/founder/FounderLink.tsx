"use client";

import Link from "next/link";
import { Anchor } from "@mantine/core";
import type { Founder, WithId } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { paths } from "@/lib/paths";

/** Le nom d'un fondateur, vers sa fiche (quand toute la ligne ne peut pas etre le lien). */
export function FounderLink({ founder }: { founder: WithId<Founder> }) {
  const { program } = useProgram();
  const { batch } = useBatch();
  return (
    <Anchor component={Link} href={paths.founder(program.id, batch.id, founder.id)} inherit className="tap-link">
      {founder.name}
    </Anchor>
  );
}

/**
 * `founderLinks(ids)` : les noms separes par des virgules, chacun vers sa fiche,
 * « Founder » pour un profil que le visiteur ne lit pas. Un tableau : vide, `Field` masque le champ.
 */
export function useFounderLinks() {
  const { foundersById } = useFounders();
  return (ids: string[]) =>
    ids.map((id, i) => {
      const f = foundersById.get(id);
      return (
        <span key={id}>
          {i > 0 && ", "}
          {f ? <FounderLink founder={f} /> : "Founder"}
        </span>
      );
    });
}
