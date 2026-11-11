"use client";

import { useMemo, type ReactNode } from "react";
import type { Batch, Program, WithId } from "@shared/types";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener, useQueryListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { LevelGate } from "@/components/ui/LevelGate";
import { paths } from "@/lib/paths";

// ----------------------------
// Niveau 1 : un programme
// ----------------------------
// Monte par app/(app)/programs/[programId]/layout.tsx. Porte le programme et
// la liste de ses batchs. Sous ce Provider, `program` n'est jamais nul.

type ProgramValue = {
  program: WithId<Program>;
  batches: WithId<Batch>[];
  isBatchesLoading: boolean;
};

const [ProgramContextProvider, useProgram] = createStrictContext<ProgramValue>("Program");
export { useProgram };

export function ProgramProvider({ children }: { children: ReactNode }) {
  const { programId } = useParamsTS<{ programId: string }>();
  const program = useDocListener(refs.program(programId));
  const batches = useQueryListener(queries.batchesOfProgram(programId));

  const value = useMemo<ProgramValue | null>(
    () =>
      program.data
        ? {
            program: program.data,
            // Le plus recent d'abord.
            batches: [...batches.data].sort((a, b) => b.startDayString.localeCompare(a.startDayString)),
            isBatchesLoading: batches.isLoading,
          }
        : null,
    [program.data, batches.data, batches.isLoading],
  );

  return (
    <LevelGate isLoading={program.isLoading} found={value !== null} error={program.error} backHref={paths.programs()}>
      {value && <ProgramContextProvider value={value}>{children}</ProgramContextProvider>}
    </LevelGate>
  );
}
