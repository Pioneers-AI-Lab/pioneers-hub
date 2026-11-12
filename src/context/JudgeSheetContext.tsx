"use client";

import { useState, type ReactNode } from "react";
import type { JudgeKey, JudgeSheet } from "@shared/callables";
import { createStrictContext } from "@/lib/createStrictContext";
import { useCallable } from "@/hooks/useCallable";
import { useParamsTS } from "@/hooks/useParamsTS";
import { Empty } from "@/components/ui/Section";
import { PageLoader } from "@/components/ui/PageLoader";

// ----------------------------
// Feuille d'un jure (/judge/[eventId]/[judgeId]#secret), sans compte
// ----------------------------
// Monte par app/(form)/judge/.../layout.tsx. Le secret est le FRAGMENT de
// l'adresse : lu dans le navigateur, envoye seulement a la callable. La feuille
// est relue apres chaque enregistrement (`reload`).

type JudgeSheetValue = { sheet: JudgeSheet; judgeKey: JudgeKey; reload: () => void };

const [JudgeSheetContextProvider, useJudgeSheet] = createStrictContext<JudgeSheetValue>("JudgeSheet");
export { useJudgeSheet };

export function JudgeSheetProvider({ children }: { children: ReactNode }) {
  const { eventId, judgeId } = useParamsTS<{ eventId: string; judgeId: string }>();
  // Pas de fragment au pre-rendu : la feuille attend le navigateur.
  const [key] = useState(() => (typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.slice(1))));
  const judgeKey = { eventId, judgeId, key };
  const { data, error, isLoading, reload } = useCallable("getJudgeSheet", judgeKey, { enabled: key !== "" });

  if (key && isLoading) return <PageLoader />;
  if (!data) return <Empty>{error ?? "This judging link is incomplete. Open it again from the message you received."}</Empty>;
  return <JudgeSheetContextProvider value={{ sheet: data, judgeKey, reload }}>{children}</JudgeSheetContextProvider>;
}
