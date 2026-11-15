"use client";

import type { ReactNode } from "react";
import { Button, Stack, Text } from "@mantine/core";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";

/**
 * Confirmation d'archivage (staff : tache, formulaire, evenement) : « Archive this
 * <what>? », ce que l'archive change (`children`), puis « Archive » en rouge.
 */
export function ArchiveDialog({
  what,
  opened,
  onClose,
  onArchive,
  children,
}: {
  what: string;
  opened: boolean;
  onClose: () => void;
  onArchive: () => void;
  children: ReactNode;
}) {
  return (
    <ResponsiveDialog opened={opened} onClose={onClose} title={`Archive this ${what}?`}>
      <Stack>
        <Text size="sm">{children}</Text>
        <Button size="md" color="red" fullWidth onClick={onArchive}>
          Archive
        </Button>
      </Stack>
    </ResponsiveDialog>
  );
}
