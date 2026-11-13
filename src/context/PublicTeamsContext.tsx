"use client";

import { useMemo, type ReactNode } from "react";
import { canReadFounderDirectory, roleInBatch } from "@shared/access";
import { matchingOf } from "@shared/events";
import { byGroupOrder, type GeneratorMode } from "@shared/teamGenerator";
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
// Les groupes du matching de l'evenement (/groups/[eventId], et les anciennes
// adresses /lunch-roulette et /challenge-teams) : tables ou equipes selon le
// mode du matching ; un evenement sans matching est introuvable. SANS COMPTE : l'evenement est public, et les groupes le sont
// une fois publies (la requete porte le filtre que la regle `teams` exige).
//
// Ce que chacun voit des membres, selon les regles des fiches fondateurs :
//   - fondateur du batch, staff, investor : toutes les fiches (photo, nom
//     complet, profil), comme l'annuaire du batch ;
//   - sans compte : les fiches des fondateurs qui ont consenti a un profil
//     public, et pour les autres le nom court du groupe (`memberNames`,
//     prenom + initiale), sans photo.
// Connecte et fondateur du batch : son groupe est repere (`viewerFounderId`).

type PublicTeamsValue = {
  event: WithId<PioneersEvent>;
  mode: GeneratorMode;
  groups: WithId<EventTeam>[];
  /** Profil du visiteur dans le batch de l'evenement (`null` sans compte ou hors batch). */
  viewerFounderId: string | null;
  /** Fiches lisibles par ce visiteur (toutes, ou seulement les profils publics). */
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
  const isWaiting = !batchId || isAuthLoading || isMembershipsLoading;
  // Une requete que les regles accepteraient pour CE visiteur (sinon refus = erreur).
  const scope = canReadFounderDirectory(roleInBatch(viewer, viewerFounderId)) ? "batch" : "public";
  const founders = useQueryListener(isWaiting || !batchId ? undefined : queries.foundersOfBatch(batchId, scope));
  const startups = useQueryListener(batchId ? queries.startupsOfBatch(batchId) : undefined);

  const value = useMemo<PublicTeamsValue | null>(() => {
    const e = event.data;
    // Le mode vient du matching de l'evenement (equipes ou tables) ; sans matching, rien a montrer.
    const mode = e ? matchingOf(e)?.mode : undefined;
    if (!e || !mode || e.archivedDateISOString !== null) return null;
    return {
      event: e,
      mode,
      groups: [...groups.data].sort(byGroupOrder),
      viewerFounderId,
      foundersById: new Map(founders.data.map((f) => [f.id, f])),
      startupsById: new Map(startups.data.map((s) => [s.id, s])),
      canOpenEvent: scope === "batch",
    };
  }, [event.data, groups.data, scope, viewerFounderId, founders.data, startups.data]);

  return (
    <LevelGate
      isLoading={event.isLoading || groups.isLoading || (event.data !== null && (founders.isLoading || startups.isLoading))}
      found={value !== null}
      error={event.error}
      backHref={paths.home()}
    >
      {value && <PublicTeamsContextProvider value={value}>{children}</PublicTeamsContextProvider>}
    </LevelGate>
  );
}
