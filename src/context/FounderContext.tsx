"use client";

import { useMemo, type ReactNode } from "react";
import { canReadFounderDirectory, canReadFounderProfile, isInsider } from "@shared/access";
import type {
  Attendance,
  Founder,
  FounderDirectory,
  FounderInternal,
  FounderProfile,
  FounderStats,
  FounderWeek,
  Membership,
  ScoreSignals,
  WithId,
} from "@shared/types";
import { queries, refs, type WithParent } from "@/lib/firestore/refs";
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
// Monte par .../founders/[founderId]/layout.tsx. Chaque document n'est lu que
// si le role y a droit : on n'ouvre pas un ecouteur que les regles
// refuseraient (il remonterait en erreur de connexion).
//   tous           founders/{id}
//   batch          private/directory, equipes (memberships)
//   lui-meme, IC   private/profile, semaines (founderWeeks)
//   staff, IC      private/internal, founderStats, scoreSignals, presences
// Le score lui-meme vient de CohortContext (deja lu pour les listes).

type FounderValue = {
  founder: WithId<Founder>;
  /** `null` si le visiteur n'y a pas droit, ou si le document n'existe pas encore. */
  directory: WithId<FounderDirectory> | null;
  profile: WithId<FounderProfile> | null;
  internal: WithId<FounderInternal> | null;
  /** Equipes successives (hackathons, startup), les plus recentes d'abord. Vide pour un visiteur public. */
  teamMemberships: WithId<Membership>[];
  /** Presence, reseau (staff et IC). */
  stats: WithId<FounderStats> | null;
  /** Detail des sous-scores (staff et IC). */
  signals: WithId<ScoreSignals> | null;
  /** Formulaires de motivation et d'objectifs, semaine par semaine (le fondateur, staff et IC). */
  weeks: WithId<FounderWeek>[];
  /** Presence a chaque seance, `parentId` = l'evenement (staff et IC). */
  attendance: WithParent<Attendance>[];
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
  const stats = useDocListener(canSeeInternal ? refs.founderStats(founderId) : null);
  const signals = useDocListener(canSeeInternal ? refs.scoreSignals("founder", founderId) : null);
  const weeks = useQueryListener(canSeeProfile ? queries.weeksOfFounder(batch.id, founderId) : null);
  const attendance = useQueryListener(canSeeInternal ? queries.attendanceOfFounder(founderId) : null);

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
            stats: stats.data,
            signals: signals.data,
            weeks: [...weeks.data].sort((a, b) => b.weekStartDayString.localeCompare(a.weekStartDayString)),
            attendance: attendance.data,
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
      stats.data,
      signals.data,
      weeks.data,
      attendance.data,
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
