"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import type { EventKind, EventTeam, PioneersEvent, WithId } from "@shared/types";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener, useQueryListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { useAdmin } from "@/context/AdminContext";
import { LevelGate } from "@/components/ui/LevelGate";
import { PageLoader } from "@/components/ui/PageLoader";
import { BlockedState } from "@/components/ui/BlockedState";

// ----------------------------
// Admin : un evenement a equipes et ses equipes (publiees ou non)
// ----------------------------
// Monte par admin/challenge-teams/[eventId]/layout.tsx et
// admin/lunch-roulette/[eventId]/layout.tsx. Un lien vers un evenement d'un
// autre batch bascule le batch de travail sur le sien : les participants et
// l'historique sont ceux de SON batch.

type AdminEventValue = {
  event: WithId<PioneersEvent>;
  teams: WithId<EventTeam>[];
  isTeamsLoading: boolean;
};

const [AdminEventContextProvider, useAdminEvent] = createStrictContext<AdminEventValue>("AdminEvent");
export { useAdminEvent };

/** Ordre d'affichage : `…-t2` avant `…-t10`. */
const teamOrder = (id: string) => Number(id.match(/(\d+)$/)?.[1] ?? 0);

export function AdminEventProvider({ kind, backHref, children }: { kind: EventKind; backHref: string; children: ReactNode }) {
  const { eventId } = useParamsTS<{ eventId: string }>();
  const { batch, batches, selectBatch } = useAdmin();
  const event = useDocListener(refs.event(eventId));
  const teams = useQueryListener(queries.teamsOfEvent(eventId));

  const eventBatchId = event.data?.batchId ?? null;
  useEffect(() => {
    if (eventBatchId && eventBatchId !== batch.id) selectBatch(eventBatchId);
  }, [eventBatchId, batch.id, selectBatch]);

  const value = useMemo<AdminEventValue | null>(() => {
    if (!event.data || event.data.kind !== kind || event.data.archivedDateISOString !== null) return null;
    return {
      event: event.data,
      teams: [...teams.data].sort((a, b) => teamOrder(a.id) - teamOrder(b.id)),
      isTeamsLoading: teams.isLoading,
    };
  }, [event.data, kind, teams.data, teams.isLoading]);

  // Batch archive : hors de la liste de travail, l'outil ne s'y applique plus.
  if (eventBatchId && !batches.some((b) => b.id === eventBatchId)) return <BlockedState reason="not_found" backHref={backHref} />;
  if (eventBatchId && eventBatchId !== batch.id) return <PageLoader />;
  return (
    <LevelGate isLoading={event.isLoading || teams.isLoading} found={value !== null} error={event.error ?? teams.error} backHref={backHref}>
      {value && <AdminEventContextProvider value={value}>{children}</AdminEventContextProvider>}
    </LevelGate>
  );
}
