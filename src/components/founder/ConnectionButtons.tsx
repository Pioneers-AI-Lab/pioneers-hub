"use client";

import { Divider, Group } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconStar, IconStarFilled } from "@tabler/icons-react";
import { reachesShortlistDone } from "@shared/tasks";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";
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
 * Staff en vue Founder (`canViewAs`) : les regles refusent son ecriture (le fondateur
 * seul ecrit ses listes) ; un clic dit pourquoi au lieu d'une erreur (demande du 17/11).
 */
function useConnectionToggles(founderId: string) {
  const { role, canViewAs } = useBatch();
  const { founderId: myFounderId, shortlisted, met, isLoading } = useMyConnections();
  const { foundersById } = useFounders();
  if (role !== "founder" || !myFounderId || myFounderId === founderId || isLoading) return null;
  const lists = { shortlistedFounderIds: shortlisted, metFounderIds: met };
  return TOGGLES.map((t) => ({
    ...t,
    on: lists[t.list].has(founderId),
    write: canViewAs
      ? async () => void notifications.show({ message: "Preview: only the founder can change their shortlist." })
      : (next: boolean) => {
          // L'ajout qui amene la shortlist au minimum date la tache shortlist du To do.
          const reachesDone = t.list === "shortlistedFounderIds" && next && reachesShortlistDone(myFounderId, [...shortlisted], founderId, foundersById);
          return setFounderConnection(myFounderId, t.list, founderId, next, reachesDone);
        },
  }));
}

/**
 * Fiche d'un AUTRE fondateur : « Shortlist » et « Mark as met », en boutons texte
 * precedes de l'icone de la grille (meme signal), sous un filet ; la section suivante perd le sien
 * (`.connection-buttons + .section`, globals.css ; demandes du 17/11).
 */
export function ConnectionButtons({ founderId }: { founderId: string }) {
  const toggles = useConnectionToggles(founderId);
  if (!toggles) return null;
  return (
    <div className="connection-buttons">
      <Divider mt="md" color="dark.4" />
      <Group grow gap="sm" mt="md">
        {toggles.map(({ list, on, write, label, onLabel, Icon, OnIcon }) => (
          <ToggleButton key={list} on={on} onToggle={write} leftSection={on ? <OnIcon size={18} /> : <Icon size={18} />}>
            {on ? onLabel : label}
          </ToggleButton>
        ))}
      </Group>
    </div>
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
    <Group gap="xs" wrap="nowrap">
      {toggles.map(({ list, on, write, label, Icon, OnIcon }) => (
        <ToggleIcon key={list} on={on} onToggle={write} label={label}>
          {on ? <OnIcon size={20} /> : <Icon size={20} />}
        </ToggleIcon>
      ))}
    </Group>
  );
}
