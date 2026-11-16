"use client";

import { Text, type TextProps } from "@mantine/core";
import { useDocListener } from "@/hooks/useFirestoreListener";
import { refs } from "@/lib/firestore/refs";
import { formatDateTime } from "@/lib/format";

// ----------------------------
// Ou en est la synchro de l'agenda Google du batch (SPECS §2, 16/11)
// ----------------------------
// Lu dans `calendarSyncs/{batchId}` (ecrit par services/calendarSync.ts) :
// Admin > Events et Admin > Batch settings disent la meme chose.

export function CalendarSyncStatus({ batchId, ...props }: { batchId: string } & TextProps) {
  const sync = useDocListener(refs.calendarSync(batchId)).data;
  const text = sync?.lastError
    ? `Last sync failed (${formatDateTime(sync.lastSyncDateISOString)}): ${sync.lastError}`
    : sync?.lastSuccessDateISOString
      ? `From Google Calendar, every 5 minutes. Last sync: ${formatDateTime(sync.lastSuccessDateISOString)}.`
      : "From Google Calendar. Not synced yet: it runs within 5 minutes.";
  return (
    <Text size="sm" c={sync?.lastError ? "red.4" : "dimmed"} {...props}>
      {text}
    </Text>
  );
}
