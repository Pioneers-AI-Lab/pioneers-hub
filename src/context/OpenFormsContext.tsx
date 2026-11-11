"use client";

import { useMemo, type ReactNode } from "react";
import type { Form, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";

// Formulaires ouverts du batch (publics), pour « To do ». Monte par todo/layout.tsx.

type OpenFormsValue = { forms: WithId<Form>[]; isLoading: boolean };

const [OpenFormsContextProvider, useOpenForms] = createStrictContext<OpenFormsValue>("OpenForms");
export { useOpenForms };

export function OpenFormsProvider({ children }: { children: ReactNode }) {
  const { batch } = useBatch();
  const forms = useQueryListener(queries.openFormsOfBatch(batch.id));
  const value = useMemo<OpenFormsValue>(
    () => ({
      // Echeance la plus proche d'abord, sans echeance a la fin.
      forms: forms.data
        .filter((f) => f.archivedDateISOString === null)
        .sort((a, b) => (a.deadlineDateISOString ?? "9").localeCompare(b.deadlineDateISOString ?? "9")),
      isLoading: forms.isLoading,
    }),
    [forms.data, forms.isLoading],
  );
  return <OpenFormsContextProvider value={value}>{children}</OpenFormsContextProvider>;
}
