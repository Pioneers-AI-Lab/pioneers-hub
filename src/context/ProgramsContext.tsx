"use client";

import { useMemo, type ReactNode } from "react";
import type { Program, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";

// ----------------------------
// Liste des programmes
// ----------------------------
// Monte par app/(app)/programs/layout.tsx. Public (nom, description).

type ProgramsValue = {
  programs: WithId<Program>[];
  isLoading: boolean;
};

const [ProgramsContextProvider, usePrograms] = createStrictContext<ProgramsValue>("Programs");
export { usePrograms };

export function ProgramsProvider({ children }: { children: ReactNode }) {
  const programs = useQueryListener(queries.activePrograms());

  const value = useMemo<ProgramsValue>(
    () => ({
      programs: [...programs.data].sort((a, b) => a.name.localeCompare(b.name)),
      isLoading: programs.isLoading,
    }),
    [programs.data, programs.isLoading],
  );

  return <ProgramsContextProvider value={value}>{children}</ProgramsContextProvider>;
}
