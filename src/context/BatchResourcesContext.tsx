"use client";

import { useMemo, type ReactNode } from "react";
import { canReadBatchResources } from "@shared/access";
import type { BatchResource } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener } from "@/hooks/useFirestoreListener";
import { useAdmin } from "@/context/AdminContext";
import { useBatch } from "@/context/BatchContext";

// ----------------------------
// Les liens utiles du batch (`batchResources/{batchId}`, 19/11)
// ----------------------------
// Un document par batch, a part du batch (public) : fondateurs du batch, staff et
// investors (regle `batchResources`). Monte par le layout du batch (accueil ;
// cible `null` pour un visiteur public, « View as » compris) et par celui
// d'Admin > Batch settings (batch de travail).

type BatchResourcesValue = {
  /** Dans l'ordre de l'accueil ; vide tant que le staff n'en a pas mis. */
  resources: BatchResource[];
  /** Derniere ecriture (le formulaire de l'Admin repart de la base a chaque changement). */
  updatedDateISOString: string | null;
};

const NO_RESOURCES: BatchResource[] = [];

const [BatchResourcesContextProvider, useBatchResources] = createStrictContext<BatchResourcesValue>("BatchResources");
export { useBatchResources };

function ResourcesOf({ batchId, children }: { batchId: string | null; children: ReactNode }) {
  const { data } = useDocListener(batchId ? refs.batchResources(batchId) : null);
  const value = useMemo(() => ({ resources: data?.items ?? NO_RESOURCES, updatedDateISOString: data?.updatedDateISOString ?? null }), [data]);
  return <BatchResourcesContextProvider value={value}>{children}</BatchResourcesContextProvider>;
}

/** Sous un batch : seulement pour qui peut les lire. */
export function BatchResourcesProvider({ children }: { children: ReactNode }) {
  const { batch, role } = useBatch();
  return <ResourcesOf batchId={canReadBatchResources(role) ? batch.id : null}>{children}</ResourcesOf>;
}

/** Sous l'Admin : le batch de travail. */
export function AdminBatchResourcesProvider({ children }: { children: ReactNode }) {
  const { batch } = useAdmin();
  return <ResourcesOf batchId={batch.id}>{children}</ResourcesOf>;
}
