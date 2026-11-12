"use client";

import { useMemo, type ReactNode } from "react";
import type { ChallengeTask } from "@shared/callables";
import { createStrictContext } from "@/lib/createStrictContext";
import { useCallable } from "@/hooks/useCallable";
import { useBatch } from "@/context/BatchContext";

// ----------------------------
// Debrief des hackathons du fondateur connecte (SPECS §4.2, §4.3)
// ----------------------------
// Une seule callable, `myChallengeTasks`, rend pour chaque hackathon commence
// l'equipe du fondateur, les avis qu'il a deja donnes et les resultats saisis :
// sinon il faudrait un ecouteur par evenement et par sous-collection. Monte par
// todo/layout.tsx ; `reload` apres une saisie.

type ChallengeTasksValue = {
  tasks: ChallengeTask[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
};

const [ChallengeTasksContextProvider, useChallengeTasks] = createStrictContext<ChallengeTasksValue>("ChallengeTasks");
export { useChallengeTasks };

export function ChallengeTasksProvider({ children }: { children: ReactNode }) {
  const { batch } = useBatch();
  const { data, error, isLoading, reload } = useCallable("myChallengeTasks", { batchId: batch.id });
  const value = useMemo<ChallengeTasksValue>(
    () => ({ tasks: data?.tasks ?? [], isLoading, error, reload }),
    [data, isLoading, error, reload],
  );
  return <ChallengeTasksContextProvider value={value}>{children}</ChallengeTasksContextProvider>;
}
