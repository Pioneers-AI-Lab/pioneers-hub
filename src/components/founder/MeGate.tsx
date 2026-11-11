"use client";

import type { ReactNode } from "react";
import { useBatch } from "@/context/BatchContext";
import { FounderProvider } from "@/context/FounderContext";
import { useProgram } from "@/context/ProgramContext";
import { BlockedState } from "@/components/ui/BlockedState";
import { paths } from "@/lib/paths";

/**
 * Monte le fondateur CONNECTE (son id vient du rattachement, pas de l'URL).
 * Reserve aux fondateurs du batch : « Me » et « To do ».
 */
export function MeGate({ children }: { children: ReactNode }) {
  const { program } = useProgram();
  const { batch, viewerFounderId } = useBatch();
  if (!viewerFounderId) return <BlockedState reason="forbidden" backHref={paths.batch(program.id, batch.id)} />;
  return <FounderProvider founderId={viewerFounderId}>{children}</FounderProvider>;
}
