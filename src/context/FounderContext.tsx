"use client";

import { useMemo, type ReactNode } from "react";
import { canReadFounderDirectory, canReadFounderProfile, isInsider } from "@shared/access";
import type { Founder, FounderDirectory, FounderInternal, FounderProfile, Membership, WithId } from "@shared/types";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener, useQueryListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { LevelGate } from "@/components/ui/LevelGate";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { paths } from "@/lib/paths";

// ----------------------------
// Niveau 3 : un fondateur
// ----------------------------
// Monte par .../founders/[founderId]/layout.tsx. Quatre documents, chacun lu
// seulement si le role y a droit : on n'ouvre pas un ecouteur que les regles
// refuseraient (il remonterait en erreur de connexion).

type FounderValue = {
  founder: WithId<Founder>;
  /** `null` si le visiteur n'y a pas droit, ou si le document n'existe pas encore. */
  directory: WithId<FounderDirectory> | null;
  profile: WithId<FounderProfile> | null;
  internal: WithId<FounderInternal> | null;
  /** Equipes successives (hackathons, startup), les plus recentes d'abord. Vide pour un visiteur public. */
  teamMemberships: WithId<Membership>[];
  canSeeDirectory: boolean;
  /** Le visiteur est ce fondateur : il peut modifier son profil. */
  isSelf: boolean;
  isDetailsLoading: boolean;
};

const [FounderContextProvider, useFounder] = createStrictContext<FounderValue>("Founder");
export { useFounder };

/**
 * `founderId` explicite pour « Me » (le fondateur connecte) ; sinon celui de l'URL.
 */
export function FounderProvider({ children, founderId: explicitId }: { children: ReactNode; founderId?: string }) {
  const params = useParamsTS<{ founderId?: string }>();
  const founderId = explicitId ?? params.founderId ?? "";
  const { program } = useProgram();
  const { batch, role, viewerFounderId } = useBatch();

  const canSeeDirectory = canReadFounderDirectory(role);
  const canSeeProfile = canReadFounderProfile(role, viewerFounderId, founderId);
  const canSeeInternal = isInsider(role);

  const founder = useDocListener(refs.founder(founderId));
  const directory = useDocListener(canSeeDirectory ? refs.founderDirectory(founderId) : null);
  const profile = useDocListener(canSeeProfile ? refs.founderProfile(founderId) : null);
  const internal = useDocListener(canSeeInternal ? refs.founderInternal(founderId) : null);
  const teamMemberships = useQueryListener(canSeeDirectory ? queries.teamMembershipsOfFounder(batch.id, founderId) : null);

  const found = founder.data !== null && founder.data.batchId === batch.id;

  const value = useMemo<FounderValue | null>(
    () =>
      found && founder.data
        ? {
            founder: founder.data,
            directory: directory.data,
            profile: profile.data,
            internal: internal.data,
            teamMemberships: [...teamMemberships.data].sort((a, b) => b.startDayString.localeCompare(a.startDayString)),
            canSeeDirectory,
            isSelf: viewerFounderId === founderId,
            isDetailsLoading: directory.isLoading || profile.isLoading || internal.isLoading,
          }
        : null,
    [
      found,
      founder.data,
      directory.data,
      profile.data,
      internal.data,
      teamMemberships.data,
      canSeeDirectory,
      viewerFounderId,
      founderId,
      directory.isLoading,
      profile.isLoading,
      internal.isLoading,
    ],
  );

  return (
    <LevelGate
      isLoading={founder.isLoading}
      found={value !== null}
      error={founder.error}
      backHref={paths.founders(program.id, batch.id)}
    >
      {value && <FounderContextProvider value={value}>{children}</FounderContextProvider>}
    </LevelGate>
  );
}
