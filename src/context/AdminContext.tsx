"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { isStaffViewer } from "@shared/access";
import type { Batch, Form, Founder, Membership, PioneersEvent, Program, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { errorMessage } from "@/lib/errors";
import { saveUserPreferences } from "@/lib/firestore/write";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useAuth } from "@/context/AuthContext";
import { BlockedState } from "@/components/ui/BlockedState";
import { PageLoader } from "@/components/ui/PageLoader";
import { paths } from "@/lib/paths";

// ----------------------------
// Espace admin (/admin) : les outils du staff, hors de l'arbre d'un batch
// ----------------------------
// Monte par app/(app)/admin/layout.tsx. GARDE : seul un compte `staff` entre
// (les regles refuseraient de toute facon les ecritures). Le role se lit sur
// le compte (`isStaffViewer`), pas sur un batch : /admin n'est sous aucun batch.
//
// Le batch de travail se CHOISIT dans chaque outil (BatchPicker) : un seul
// choix pour tous les outils, retenu sur le compte (`users.preferences.batchId`,
// suit le compte d'un appareil a l'autre) ; a defaut, le batch en cours.
// Les listes du batch choisi sont lues ICI, une fois pour tous les outils :
// fondateurs (participants des tirages), evenements (brouillons compris),
// appartenances (historique « qui a ete avec qui »), formulaires.

type AdminValue = {
  programsById: Map<string, WithId<Program>>;
  batches: WithId<Batch>[];
  batch: WithId<Batch>;
  selectBatch: (batchId: string) => void;
  /** Non archives, par nom ; les fondateurs partis (`left`) restent pour l'historique. */
  founders: WithId<Founder>[];
  foundersById: Map<string, WithId<Founder>>;
  /** Non archives, brouillons compris, du plus recent au plus ancien. */
  events: WithId<PioneersEvent>[];
  eventsById: Map<string, WithId<PioneersEvent>>;
  teamMemberships: WithId<Membership>[];
  /** Non archives, du plus recent au plus ancien. */
  forms: WithId<Form>[];
  isLoading: boolean;
};

const [AdminContextProvider, useAdmin] = createStrictContext<AdminValue>("Admin");
export { useAdmin };

/**
 * Le batch par defaut, faute de choix : celui en cours (le plus recemment
 * commence s'il y en a plusieurs), sinon le plus recent. `batches` est trie
 * du debut le plus recent au plus ancien.
 */
const defaultBatch = (batches: WithId<Batch>[]): WithId<Batch> | null =>
  batches.find((b) => b.status === "active") ?? batches[0] ?? null;

export function AdminProvider({ children }: { children: ReactNode }) {
  const { user, viewer, isLoading: isAuthLoading } = useAuth();
  const isStaff = isStaffViewer(viewer);

  const programs = useQueryListener(isAuthLoading ? undefined : isStaff ? queries.activePrograms() : null);
  const batchList = useQueryListener(isAuthLoading ? undefined : isStaff ? queries.activeBatches() : null);
  // L'ecriture locale de Firestore renvoie aussitot le nouveau choix par
  // l'ecouteur du compte : pas d'etat local a tenir en plus.
  const preferredId = user?.preferences?.batchId ?? null;

  const batches = useMemo(
    () => [...batchList.data].sort((a, b) => b.startDayString.localeCompare(a.startDayString)),
    [batchList.data],
  );
  const batch = batches.find((b) => b.id === preferredId) ?? defaultBatch(batches);
  const batchId = batch?.id ?? null;

  const founders = useQueryListener(batchId ? queries.foundersOfBatch(batchId, "batch") : batchList.isLoading ? undefined : null);
  const events = useQueryListener(batchId ? queries.eventsOfBatch(batchId) : batchList.isLoading ? undefined : null);
  const memberships = useQueryListener(batchId ? queries.teamMembershipsOfBatch(batchId) : batchList.isLoading ? undefined : null);
  const forms = useQueryListener(batchId ? queries.formsOfBatch(batchId) : batchList.isLoading ? undefined : null);

  const uid = user?.id ?? null;
  const selectBatch = useCallback(
    (id: string) => {
      if (!uid || id === preferredId) return;
      saveUserPreferences(uid, { batchId: id }).catch((err: unknown) =>
        notifications.show({ color: "red", message: errorMessage(err) }),
      );
    },
    [uid, preferredId],
  );

  const value = useMemo<AdminValue | null>(() => {
    if (!batch) return null;
    const founderList = founders.data
      .filter((f) => f.archivedDateISOString === null)
      .sort((a, b) => a.name.localeCompare(b.name));
    const eventList = events.data
      .filter((e) => e.archivedDateISOString === null)
      .sort((a, b) => b.startDateISOString.localeCompare(a.startDateISOString));
    return {
      programsById: new Map(programs.data.map((p) => [p.id, p])),
      batches,
      batch,
      selectBatch,
      founders: founderList,
      foundersById: new Map(founderList.map((f) => [f.id, f])),
      events: eventList,
      eventsById: new Map(eventList.map((e) => [e.id, e])),
      teamMemberships: memberships.data,
      forms: forms.data
        .filter((f) => f.archivedDateISOString === null)
        .sort((a, b) => b.createdDateISOString.localeCompare(a.createdDateISOString)),
      isLoading: founders.isLoading || events.isLoading || memberships.isLoading || forms.isLoading,
    };
  }, [batch, batches, programs.data, selectBatch, founders.data, founders.isLoading, events.data, events.isLoading, memberships.data, memberships.isLoading, forms.data, forms.isLoading]);

  if (isAuthLoading) return <PageLoader />;
  if (!isStaff) return <BlockedState reason="forbidden" backHref={paths.home()} />;
  if (batchList.isLoading || programs.isLoading) return <PageLoader />;
  if (!value)
    return (
      <Stack gap="xs" py="xl">
        <Title order={3}>No batch yet</Title>
        <Text c="dimmed">Create a program and a batch first: the tools work on the founders of a batch.</Text>
      </Stack>
    );
  return <AdminContextProvider value={value}>{children}</AdminContextProvider>;
}
