"use client";

import { Group } from "@mantine/core";
import { IconCheck, IconStar, IconStarFilled } from "@tabler/icons-react";
import { useBatch } from "@/context/BatchContext";
import { useMyConnections } from "@/context/MyConnectionsContext";
import { setFounderConnection } from "@/lib/firestore/write";
import { ToggleButton, ToggleIcon } from "@/components/ui/ToggleButton";

/** Les deux listes, leurs libelles et leurs icones (pleine une fois cochee). */
const TOGGLES = [
  { list: "shortlistedFounderIds", label: "Shortlist", onLabel: "Shortlisted", Icon: IconStar, OnIcon: IconStarFilled },
  { list: "metFounderIds", label: "Mark as met", onLabel: "Met", Icon: IconCheck, OnIcon: IconCheck },
] as const;

/**
 * Les bascules (Shortlist, Met) du VISITEUR fondateur du batch sur `founderId`
 * (MyConnectionsContext), avec leur ecriture ; `null` si le visiteur n'est pas
 * fondateur du batch, si c'est sa propre fiche, ou tant que ses listes ne sont pas lues.
 */
function useConnectionToggles(founderId: string) {
  const { role } = useBatch();
  const { founderId: myFounderId, shortlisted, met, isLoading } = useMyConnections();
  if (role !== "founder" || !myFounderId || myFounderId === founderId || isLoading) return null;
  const lists = { shortlistedFounderIds: shortlisted, metFounderIds: met };
  return TOGGLES.map((t) => ({
    ...t,
    on: lists[t.list].has(founderId),
    write: (next: boolean) => setFounderConnection(myFounderId, t.list, founderId, next),
  }));
}

/** Fiche d'un AUTRE fondateur : « Shortlist » et « Mark as met », en boutons texte. */
export function ConnectionButtons({ founderId }: { founderId: string }) {
  const toggles = useConnectionToggles(founderId);
  if (!toggles) return null;
  return (
    <Group grow gap="sm" mt="md">
      {toggles.map((t) => (
        <ToggleButton key={t.list} on={t.on} onToggle={t.write}>
          {t.on ? t.onLabel : t.label}
        </ToggleButton>
      ))}
    </Group>
  );
}

/**
 * Liste et grille de l'annuaire : les memes bascules en icones (place comptee),
 * sans infobulle (demande du 16/11). Sur une carte, posees sur la photo (`.card-overlay`).
 */
export function ConnectionToggles({ founderId }: { founderId: string }) {
  const toggles = useConnectionToggles(founderId);
  if (!toggles) return null;
  return (
    <Group gap={6} wrap="nowrap">
      {toggles.map(({ list, on, write, label, Icon, OnIcon }) => (
        <ToggleIcon key={list} on={on} onToggle={write} label={label}>
          {on ? <OnIcon size={20} /> : <Icon size={20} />}
        </ToggleIcon>
      ))}
    </Group>
  );
}
