"use client";

import { useState } from "react";
import { Button, CloseButton, FileButton, Group, Paper, Stack, Text } from "@mantine/core";
import { useFounder } from "@/context/FounderContext";
import { useAction } from "@/hooks/useAction";
import { preparePhoto, PHOTO_MIN_SIDE } from "@/lib/photo";
import { removeProfilePhoto, saveProfilePhoto } from "@/lib/profile";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { FounderCover } from "./FounderCover";

/**
 * La photo du profil, enregistree des qu'elle est choisie (sans attendre
 * « Save changes ») : apercu tel que la carte de l'annuaire la montre, puis depot.
 * La croix en haut a droite la retire, apres confirmation (icone : exception
 * assumee a « pas d'icone », faute de place sur la photo).
 * `disabled` : le compte n'est pas rattache a sa personne (la vignette vit dans `people`).
 */
export function PhotoUpload({ disabled }: { disabled: boolean }) {
  const { founder } = useFounder();
  const uploading = useAction();
  const removing = useAction();
  const [isConfirming, setConfirming] = useState(false);
  const hasCover = Boolean(founder.coverPhotoUrl);
  const isBusy = uploading.isBusy || removing.isBusy;

  const upload = (file: File | null) => {
    if (file) void uploading.run(async () => saveProfilePhoto(founder, await preparePhoto(file)), "Photo updated");
  };
  const remove = () => void removing.run(() => removeProfilePhoto(founder), "Photo removed").then(() => setConfirming(false));

  return (
    <Stack gap="sm" align="flex-start">
      <Paper withBorder radius="md" w="100%" maw={320} pos="relative" style={{ overflow: "hidden" }}>
        <FounderCover founder={founder} />
        {(hasCover || founder.photoUrl) && !disabled && (
          <CloseButton
            aria-label="Remove photo"
            size="xl"
            radius="xl"
            className="photo-overlay-button"
            disabled={isBusy}
            onClick={() => setConfirming(true)}
          />
        )}
      </Paper>
      <Text size="sm" c="dimmed">
        {hasCover ? "" : "Required: "}Shown large on the founders grid. A clear portrait, at least {PHOTO_MIN_SIDE} px on each side.
      </Text>
      <FileButton onChange={upload} accept="image/jpeg,image/png,image/webp" disabled={disabled || removing.isBusy}>
        {(props) => (
          <Button {...props} variant="default" loading={uploading.isBusy}>
            {hasCover ? "Change photo" : "Upload a photo"}
          </Button>
        )}
      </FileButton>

      <ResponsiveDialog opened={isConfirming} onClose={() => setConfirming(false)} title="Remove this photo?">
        <Stack>
          <Text>The founders grid shows initials instead, and the profile is incomplete until a new photo is added.</Text>
          <Group grow>
            <Button variant="default" size="md" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button color="red" size="md" loading={removing.isBusy} onClick={remove}>
              Remove
            </Button>
          </Group>
        </Stack>
      </ResponsiveDialog>
    </Stack>
  );
}
