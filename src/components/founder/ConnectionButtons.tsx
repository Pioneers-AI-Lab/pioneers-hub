"use client";

import { Group } from "@mantine/core";
import { useBatch } from "@/context/BatchContext";
import { useMyConnections } from "@/context/MyConnectionsContext";
import { setFounderConnection } from "@/lib/firestore/write";
import { ToggleButton } from "@/components/ui/ToggleButton";

/**
 * Boutons « Shortlist » et « Met » sur la fiche d'un AUTRE fondateur (le visiteur
 * est fondateur du batch) : deux bascules, allumees en variante `light`. Ecrit
 * la shortlist / les rencontres du VISITEUR (MyConnectionsContext) ; rien si le
 * visiteur n'est pas fondateur du batch ou s'il est sur sa propre fiche.
 */
export function ConnectionButtons({ founderId }: { founderId: string }) {
  const { role } = useBatch();
  const { founderId: myFounderId, shortlisted, met, isLoading } = useMyConnections();
  if (role !== "founder" || !myFounderId || myFounderId === founderId) return null;

  const isShortlisted = shortlisted.has(founderId);
  const buttons = [
    { list: "shortlistedFounderIds", on: isShortlisted, label: isShortlisted ? "Shortlisted" : "Shortlist" },
    { list: "metFounderIds", on: met.has(founderId), label: met.has(founderId) ? "Met" : "Mark as met" },
  ] as const;

  return (
    <Group grow gap="sm" mt="md">
      {buttons.map(({ list, on, label }) => (
        <ToggleButton key={list} on={on} disabled={isLoading} onToggle={(next) => setFounderConnection(myFounderId, list, founderId, next)}>
          {label}
        </ToggleButton>
      ))}
    </Group>
  );
}
