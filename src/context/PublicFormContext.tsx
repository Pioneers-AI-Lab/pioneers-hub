"use client";

import type { ReactNode } from "react";
import type { PublicForm } from "@shared/callables";
import { createStrictContext } from "@/lib/createStrictContext";
import { useCallable } from "@/hooks/useCallable";
import { useParamsTS } from "@/hooks/useParamsTS";
import { BlockedState } from "@/components/ui/BlockedState";
import { PageLoader } from "@/components/ui/PageLoader";
import { paths } from "@/lib/paths";

// ----------------------------
// Formulaire public (/forms/[formId])
// ----------------------------
// Monte par app/(form)/forms/[formId]/layout.tsx. SANS COMPTE : le formulaire
// est lu par la callable `getPublicForm`, pas par un ecouteur Firestore. Les
// noms du batch ne sont pas publics : c'est le serveur qui les rend, en nom
// court. Lu une fois a l'ouverture (une reponse se donne a la version lue).
//
// `useCallable` attend de savoir QUI est le visiteur : connecte et fondateur
// du batch, il repond en son nom sans le choisir (`viewerFounderId`).

type PublicFormValue = { form: PublicForm };

const [PublicFormContextProvider, usePublicForm] = createStrictContext<PublicFormValue>("PublicForm");
export { usePublicForm };

export function PublicFormProvider({ children }: { children: ReactNode }) {
  const { formId } = useParamsTS<{ formId: string }>();
  const { data, errorCode, isLoading } = useCallable("getPublicForm", { formId });

  if (isLoading) return <PageLoader />;
  if (!data) return <BlockedState reason={errorCode === "functions/not-found" ? "not_found" : "error"} backHref={paths.home()} />;
  return <PublicFormContextProvider value={{ form: data }}>{children}</PublicFormContextProvider>;
}
