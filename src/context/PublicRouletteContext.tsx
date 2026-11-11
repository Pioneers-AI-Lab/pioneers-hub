"use client";

import { useMemo, type ReactNode } from "react";
import { canReadFounderDirectory, roleInBatch } from "@shared/access";
import type { EventTeam, Founder, PioneersEvent, Startup, WithId } from "@shared/types";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener, useQueryListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { useAuth } from "@/context/AuthContext";
import { LevelGate } from "@/components/ui/LevelGate";
import { paths } from "@/lib/paths";

// ----------------------------
// Repartition publique d'une lunch roulette (/lunch-roulette/[eventId])
// ----------------------------
// Monte par app/(app)/lunch-roulette/[eventId]/layout.tsx. SANS COMPTE :
// l'evenement est public, et les tables le sont une fois publiees (la requete
// porte le filtre que la regle `teams` exige).
//
// Ce que chacun voit des membres, selon les regles des fiches fondateurs :
//   - fondateur du batch, staff, investor : toutes les fiches (photo, nom
//     complet, profil), comme l'annuaire du batch ;
//   - sans compte : les fiches des fondateurs qui ont consenti a un profil
//     public, et pour les autres le nom court de la table (`memberNames`,
//     prenom + initiale), sans photo.
// Connecte et fondateur du batch : sa table est reperee (`viewerFounderId`).

type PublicRouletteValue = {
  event: WithId<PioneersEvent>;
  tables: WithId<EventTeam>[];
  /** Profil du visiteur dans le batch de l'evenement (`null` sans compte ou hors batch). */
  viewerFounderId: string | null;
  /** Fiches lisibles par ce visiteur (toutes, ou seulement les profils publics). */
  foundersById: Map<string, WithId<Founder>>;
  startupsById: Map<string, WithId<Startup>>;
};

const [PublicRouletteContextProvider, usePublicRoulette] = createStrictContext<PublicRouletteValue>("PublicRoulette");
export { usePublicRoulette };

/** Ordre d'affichage : `…-t2` avant `…-t10`. */
const tableOrder = (id: string) => Number(id.match(/(\d+)$/)?.[1] ?? 0);

export function PublicRouletteProvider({ children }: { children: ReactNode }) {
  const { eventId } = useParamsTS<{ eventId: string }>();
  const { viewer, memberships, isLoading: isAuthLoading, isMembershipsLoading } = useAuth();
  const event = useDocListener(refs.event(eventId));
  const tables = useQueryListener(queries.publishedTeamsOfEvent(eventId));

  const batchId = event.data?.batchId ?? null;
  const viewerFounderId = batchId ? (memberships.find((m) => m.batchId === batchId)?.founderId ?? null) : null;
  const isWaiting = !batchId || isAuthLoading || isMembershipsLoading;
  // Une requete que les regles accepteraient pour CE visiteur (sinon refus = erreur).
  const scope = canReadFounderDirectory(roleInBatch(viewer, viewerFounderId)) ? "batch" : "public";
  const founders = useQueryListener(isWaiting || !batchId ? undefined : queries.foundersOfBatch(batchId, scope));
  const startups = useQueryListener(batchId ? queries.startupsOfBatch(batchId) : undefined);

  const value = useMemo<PublicRouletteValue | null>(() => {
    const e = event.data;
    if (!e || e.kind !== "matching" || e.archivedDateISOString !== null) return null;
    return {
      event: e,
      tables: [...tables.data].sort((a, b) => tableOrder(a.id) - tableOrder(b.id)),
      viewerFounderId,
      foundersById: new Map(founders.data.map((f) => [f.id, f])),
      startupsById: new Map(startups.data.map((s) => [s.id, s])),
    };
  }, [event.data, tables.data, viewerFounderId, founders.data, startups.data]);

  return (
    <LevelGate
      isLoading={event.isLoading || tables.isLoading || (event.data !== null && (founders.isLoading || startups.isLoading))}
      found={value !== null}
      error={event.error}
      backHref={paths.home()}
    >
      {value && <PublicRouletteContextProvider value={value}>{children}</PublicRouletteContextProvider>}
    </LevelGate>
  );
}
