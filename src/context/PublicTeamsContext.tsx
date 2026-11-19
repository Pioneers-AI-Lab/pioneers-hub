"use client";

import { useMemo, type ReactNode } from "react";
import { canReadFounderDirectory, roleInBatch } from "@shared/access";
import { matchingOf } from "@shared/events";
import { byGroupOrder, visibleTeams, type GeneratorMode } from "@shared/teamGenerator";
import type { EventTeam, Founder, PioneersEvent, Startup, WithId } from "@shared/types";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener, useQueryListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { useAuth } from "@/context/AuthContext";
import { LevelGate } from "@/components/ui/LevelGate";
import { paths } from "@/lib/paths";

// ----------------------------
// Repartition publique des groupes d'un evenement
// ----------------------------
// Les groupes du matching de l'evenement (/groups/[eventId] pour des equipes,
// /lunch-roulette/[eventId] pour des tables, ancienne adresse /challenge-teams,
// `paths.groups`) : tables ou equipes selon le mode du matching ; un evenement sans matching est introuvable. SANS COMPTE : l'evenement est public, et les groupes le sont
// une fois publies (la requete porte le filtre que la regle `teams` exige).
//
// Les fiches des membres (photo, nom complet) sont publiques (decision du
// 17/11) ; une fiche introuvable s'affiche par le nom court du groupe
// (`memberNames`, prenom + initiale), sans photo.
// Connecte et fondateur du batch : son groupe est repere (`viewerFounderId`).

type PublicTeamsValue = {
  event: WithId<PioneersEvent>;
  mode: GeneratorMode;
  groups: WithId<EventTeam>[];
  /** Profil du visiteur dans le batch de l'evenement (`null` sans compte ou hors batch). */
  viewerFounderId: string | null;
  /** Les fiches du batch. */
  foundersById: Map<string, WithId<Founder>>;
  startupsById: Map<string, WithId<Startup>>;
  /** Le visiteur ouvre le batch (fondateur, staff, investor) : la page de l'evenement lui est accessible. */
  canOpenEvent: boolean;
};

const [PublicTeamsContextProvider, usePublicTeams] = createStrictContext<PublicTeamsValue>("PublicTeams");
export { usePublicTeams };

export function PublicTeamsProvider({ children }: { children: ReactNode }) {
  const { eventId } = useParamsTS<{ eventId: string }>();
  const { viewer, memberships, isLoading: isAuthLoading, isMembershipsLoading } = useAuth();
  const event = useDocListener(refs.event(eventId));
  const groups = useQueryListener(queries.publishedTeamsOfEvent(eventId));

  const batchId = event.data?.batchId ?? null;
  const viewerFounderId = batchId ? (memberships.find((m) => m.batchId === batchId)?.founderId ?? null) : null;
  const canOpenEvent = canReadFounderDirectory(roleInBatch(viewer, viewerFounderId));
  const founders = useQueryListener(batchId ? queries.foundersOfBatch(batchId) : undefined);
  const startups = useQueryListener(batchId ? queries.startupsOfBatch(batchId) : undefined);

  const value = useMemo<PublicTeamsValue | null>(() => {
    const e = event.data;
    // Le mode vient du matching de l'evenement (equipes ou tables) ; sans matching, rien a montrer.
    const mode = e ? matchingOf(e)?.mode : undefined;
    if (!e || !mode || e.archivedDateISOString !== null) return null;
    return {
      event: e,
      mode,
      // Sans les membres marques absents (masques, 19/11).
      groups: visibleTeams([...groups.data].sort(byGroupOrder)),
      viewerFounderId,
      foundersById: new Map(founders.data.map((f) => [f.id, f])),
      startupsById: new Map(startups.data.map((s) => [s.id, s])),
      canOpenEvent,
    };
  }, [event.data, groups.data, canOpenEvent, viewerFounderId, founders.data, startups.data]);

  return (
    <LevelGate
      isLoading={
        event.isLoading || groups.isLoading || isAuthLoading || isMembershipsLoading || (event.data !== null && (founders.isLoading || startups.isLoading))
      }
      found={value !== null}
      error={event.error}
      backHref={paths.home()}
    >
      {value && <PublicTeamsContextProvider value={value}>{children}</PublicTeamsContextProvider>}
    </LevelGate>
  );
}
