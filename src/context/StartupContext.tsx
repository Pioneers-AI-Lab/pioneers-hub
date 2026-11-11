"use client";

import { useMemo, type ReactNode } from "react";
import { isInsider, canReadStartupProfile, isStartupMember } from "@shared/access";
import type { Startup, StartupInternal, StartupProfile, WithId } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { LevelGate } from "@/components/ui/LevelGate";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { paths } from "@/lib/paths";

// ----------------------------
// Niveau 3 : une startup
// ----------------------------
// Monte par .../startups/[startupId]/layout.tsx. Le role « member » se calcule
// ici : il depend de la startup, pas du batch.

type StartupValue = {
  startup: WithId<Startup>;
  isMember: boolean;
  profile: WithId<StartupProfile> | null;
  internal: WithId<StartupInternal> | null;
  canSeeProfile: boolean;
  isProfileLoading: boolean;
};

const [StartupContextProvider, useStartup] = createStrictContext<StartupValue>("Startup");
export { useStartup };

export function StartupProvider({ children }: { children: ReactNode }) {
  const { startupId } = useParamsTS<{ startupId: string }>();
  const { program } = useProgram();
  const { batch, role, viewerFounderId } = useBatch();

  const startup = useDocListener(refs.startup(startupId));
  const found = startup.data !== null && startup.data.batchId === batch.id;

  // On attend la startup (ses membres) avant de savoir si l'on peut lire son profil.
  const canSeeProfile = found && startup.data ? canReadStartupProfile(role, viewerFounderId, startup.data) : false;
  const profile = useDocListener(
    startup.isLoading ? undefined : canSeeProfile ? refs.startupProfile(startupId) : null,
  );
  const internal = useDocListener(isInsider(role) ? refs.startupInternal(startupId) : null);

  const value = useMemo<StartupValue | null>(
    () =>
      found && startup.data
        ? {
            startup: startup.data,
            isMember: isStartupMember(viewerFounderId, startup.data),
            profile: profile.data,
            internal: internal.data,
            canSeeProfile,
            isProfileLoading: profile.isLoading || internal.isLoading,
          }
        : null,
    [found, startup.data, viewerFounderId, profile.data, internal.data, canSeeProfile, profile.isLoading, internal.isLoading],
  );

  return (
    <LevelGate
      isLoading={startup.isLoading}
      found={value !== null}
      error={startup.error}
      backHref={paths.startups(program.id, batch.id)}
    >
      {value && <StartupContextProvider value={value}>{children}</StartupContextProvider>}
    </LevelGate>
  );
}
