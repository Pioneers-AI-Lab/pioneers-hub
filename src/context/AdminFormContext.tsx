"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import type { Form, WithId } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { useAdmin } from "@/context/AdminContext";
import { LevelGate } from "@/components/ui/LevelGate";
import { PageLoader } from "@/components/ui/PageLoader";
import { BlockedState } from "@/components/ui/BlockedState";
import { paths } from "@/lib/paths";

// ----------------------------
// Admin : un formulaire (editeur)
// ----------------------------
// Monte par admin/forms/[formId]/layout.tsx. Comme pour les evenements, un
// formulaire d'un autre batch bascule le batch de travail sur le sien (la
// liste des evenements a rattacher est celle de son batch).

type AdminFormValue = { form: WithId<Form> };

const [AdminFormContextProvider, useAdminForm] = createStrictContext<AdminFormValue>("AdminForm");
export { useAdminForm };

export function AdminFormProvider({ children }: { children: ReactNode }) {
  const { formId } = useParamsTS<{ formId: string }>();
  const { batch, batches, selectBatch } = useAdmin();
  const form = useDocListener(refs.form(formId));

  const formBatchId = form.data?.batchId ?? null;
  useEffect(() => {
    if (formBatchId && formBatchId !== batch.id) selectBatch(formBatchId);
  }, [formBatchId, batch.id, selectBatch]);

  const value = useMemo<AdminFormValue | null>(() => (form.data ? { form: form.data } : null), [form.data]);

  // Batch archive : hors de la liste de travail, l'outil ne s'y applique plus.
  if (formBatchId && !batches.some((b) => b.id === formBatchId)) return <BlockedState reason="not_found" backHref={paths.adminForms()} />;
  if (formBatchId && formBatchId !== batch.id) return <PageLoader />;
  return (
    <LevelGate isLoading={form.isLoading} found={value !== null} error={form.error} backHref={paths.adminForms()}>
      {value && <AdminFormContextProvider value={value}>{children}</AdminFormContextProvider>}
    </LevelGate>
  );
}
