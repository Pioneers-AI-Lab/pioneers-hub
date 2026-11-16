"use client";

import { useMemo, type ReactNode } from "react";
import { isStaffViewer, roleInBatch, type BatchRole } from "@shared/access";
import type { Batch, WithId } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { LevelGate } from "@/components/ui/LevelGate";
import { useAuth } from "@/context/AuthContext";
import { useProgram } from "@/context/ProgramContext";
import { paths } from "@/lib/paths";
import { useViewAs } from "@/lib/viewAs";

// ----------------------------
// Niveau 2 : un batch, et le ROLE du visiteur dans ce batch
// ----------------------------
// Monte par app/(app)/programs/[programId]/batches/[batchId]/layout.tsx.
// Le role se calcule ICI, une fois, et tous les niveaux en dessous le lisent
// (`useBatch().role`) au lieu de refaire la verification d'acces : chez
// Trippple, Business puis AdAccount la refaisaient chacun, avec chacun sa
// redirection.
// « View as » (lib/viewAs.ts) : pour un staff, le role et le profil choisis
// remplacent les siens ICI, et nulle part ailleurs.

type BatchValue = {
  batch: WithId<Batch>;
  role: BatchRole;
  /** Profil du visiteur dans ce batch (`null` s'il n'en a pas). */
  viewerFounderId: string | null;
  /** Connecte (faux en apercu « Public » : le visiteur anonyme). Les pages le lisent ici, pas dans `useAuth`. */
  isSignedIn: boolean;
  /** Son VRAI role est staff : il a le « View as » (BatchShell), qu'il soit en apercu ou non. */
  canViewAs: boolean;
};

const [BatchContextProvider, useBatch] = createStrictContext<BatchValue>("Batch");
export { useBatch };

export function BatchProvider({ children }: { children: ReactNode }) {
  const { batchId } = useParamsTS<{ batchId: string }>();
  const { program } = useProgram();
  const { viewer, isLoading: isAuthLoading } = useAuth();
  const viewAs = useViewAs();

  const batch = useDocListener(refs.batch(batchId));
  // Le lien compte -> fondateur de CE batch. Rien a lire pour un visiteur non
  // connecte ; on attend tant qu'on ne sait pas qui il est.
  const membership = useDocListener(
    isAuthLoading ? undefined : viewer && !isStaffViewer(viewer) ? refs.membership(batchId, viewer.uid) : null,
  );

  // Un batch d'un AUTRE programme sous cette URL est un lien faux, pas un acces.
  const found = batch.data !== null && batch.data.programId === program.id;

  const value = useMemo<BatchValue | null>(() => {
    if (!found || !batch.data) return null;
    const ownFounderId = membership.data?.founderId ?? null;
    const role = roleInBatch(viewer, ownFounderId);
    const canViewAs = role === "staff";
    if (!canViewAs || !viewAs) return { batch: batch.data, role, viewerFounderId: ownFounderId, isSignedIn: viewer !== null, canViewAs };
    // Apercu : un fondateur choisi dans un autre batch ne vaut pas ici.
    const founderId = viewAs.role === "founder" && viewAs.batchId === batch.data.id ? viewAs.founderId : null;
    return { batch: batch.data, role: viewAs.role, viewerFounderId: founderId, isSignedIn: viewAs.role !== "public", canViewAs };
  }, [found, batch.data, membership.data, viewer, viewAs]);

  return (
    <LevelGate
      isLoading={batch.isLoading || membership.isLoading}
      found={value !== null}
      error={batch.error}
      backHref={paths.program(program.id)}
    >
      {value && <BatchContextProvider value={value}>{children}</BatchContextProvider>}
    </LevelGate>
  );
}
