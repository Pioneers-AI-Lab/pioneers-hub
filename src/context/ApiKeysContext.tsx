"use client";

import { useMemo, type ReactNode } from "react";
import { canUseApi } from "@shared/access";
import type { ApiKey, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useAuth } from "@/context/AuthContext";
import { BlockedState } from "@/components/ui/BlockedState";
import { PageLoader } from "@/components/ui/PageLoader";
import { paths } from "@/lib/paths";

// ----------------------------
// Les cles d'API du compte connecte (page /api-docs)
// ----------------------------
// Monte par app/(app)/api-docs/layout.tsx. Garde du sous-arbre : `canUseApi`,
// la regle meme de l'API (shared/access.ts). Ne lit que les cles du compte, et
// jamais leur valeur : elle n'est montree qu'une fois, a la creation.

type ApiKeysValue = {
  /** Plus recentes d'abord ; les revoquees restent, pour l'historique. */
  apiKeys: WithId<ApiKey>[];
  isLoading: boolean;
};

const [ApiKeysContextProvider, useApiKeys] = createStrictContext<ApiKeysValue>("ApiKeys");
export { useApiKeys };

export function ApiKeysProvider({ children }: { children: ReactNode }) {
  const { viewer, firebaseUser, isLoading: isAuthLoading } = useAuth();
  const allowed = canUseApi(viewer);
  const keys = useQueryListener(allowed && firebaseUser ? queries.myApiKeys(firebaseUser.uid) : null);

  const value = useMemo<ApiKeysValue>(
    () => ({
      apiKeys: [...keys.data].sort((a, b) => b.createdDateISOString.localeCompare(a.createdDateISOString)),
      isLoading: keys.isLoading,
    }),
    [keys.data, keys.isLoading],
  );

  if (isAuthLoading) return <PageLoader />;
  if (!allowed) return <BlockedState reason="forbidden" backHref={paths.home()} />;
  return <ApiKeysContextProvider value={value}>{children}</ApiKeysContextProvider>;
}
