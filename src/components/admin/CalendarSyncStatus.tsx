"use client";

import { Text, type TextProps } from "@mantine/core";
import { useDocListener } from "@/hooks/useFirestoreListener";
import { refs } from "@/lib/firestore/refs";
import { formatDateTime } from "@/lib/format";

// ----------------------------
// Ou en est la synchro de l'agenda Google du batch (SPECS §2, 16/11)
// ----------------------------
// Lu dans `calendarSyncs/{batchId}` (ecrit par services/calendarSync.ts) :
// Admin > Events et Admin > Batch settings disent la meme chose. Instantane si
// l'abonnement aux notifications de Google est pris, sinon toutes les 30 minutes.

export function CalendarSyncStatus({ batchId, ...props }: { batchId: string } & TextProps) {
  const sync = useDocListener(refs.calendarSync(batchId)).data;
  // Abonne (notifications de Google) : aussitot ; sinon la tache des 30 minutes.
  const isLive = Boolean(sync?.channel && sync.channel.expirationDateISOString > new Date().toISOString());
  const pace = isLive ? "updated as soon as it changes" : `every 30 minutes${sync?.channelError ? ` (instant updates off: ${sync.channelError})` : ""}`;
  const text = sync?.lastError
    ? `Last sync failed (${formatDateTime(sync.lastSyncDateISOString)}): ${sync.lastError}`
    : sync?.lastSuccessDateISOString
      ? `From Google Calendar, ${pace}. Last sync: ${formatDateTime(sync.lastSuccessDateISOString)}.`
      : "From Google Calendar. Not synced yet: Sync now, or it runs within 30 minutes.";
  return (
    <Text size="sm" c={sync?.lastError ? "red.4" : "dimmed"} {...props}>
      {text}
    </Text>
  );
}
