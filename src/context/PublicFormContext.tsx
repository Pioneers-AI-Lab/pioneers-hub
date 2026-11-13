"use client";

import { useState, type ReactNode } from "react";
import type { PublicForm, RespondentInput } from "@shared/callables";
import { createStrictContext } from "@/lib/createStrictContext";
import { useCallable } from "@/hooks/useCallable";
import { useParamsTS } from "@/hooks/useParamsTS";
import { BlockedState } from "@/components/ui/BlockedState";
import { Empty } from "@/components/ui/Section";
import { PageLoader } from "@/components/ui/PageLoader";
import { paths } from "@/lib/paths";

// ----------------------------
// Formulaire public (/forms/[formId], et /forms/[formId]#secret pour un jury)
// ----------------------------
// Monte par app/(form)/forms/[formId]/layout.tsx. SANS COMPTE : le formulaire
// est lu par la callable `getPublicForm`, pas par un ecouteur Firestore. Les
// noms du batch ne sont pas publics : c'est le serveur qui les rend, en nom
// court. Une reponse se donne a la version lue.
//
// Le repondant (SPECS §2, modele standard) : un compte connecte et rattache
// repond en son nom ; sinon la page le demande (`setRespondent`) et relit le
// formulaire, qui rend alors ses cibles (equipe, coequipiers, equipes a noter)
// et, pour une identite prouvee, ses reponses deja donnees. Un jure (lien de
// jury) est garde dans ce navigateur : un rechargement ne le redemande pas. Le
// secret du jury est le FRAGMENT de l'adresse, envoye seulement a la callable.

type PublicFormValue = {
  form: PublicForm;
  /** Le secret d'un lien de jury (`null` sinon). */
  juryKey: string | null;
  /** Ce que la page a dit du repondant (nom choisi, jure). */
  respondentInput: RespondentInput | null;
  setRespondent: (respondent: RespondentInput | null) => void;
  /** Relit le formulaire (apres un envoi : les reponses deja donnees). */
  reload: () => void;
};

const [PublicFormContextProvider, usePublicForm] = createStrictContext<PublicFormValue>("PublicForm");
export { usePublicForm };

const storageKey = (formId: string) => `form-respondent:${formId}`;

function readStored(formId: string): RespondentInput | null {
  try {
    const raw = window.localStorage.getItem(storageKey(formId));
    return raw ? (JSON.parse(raw) as RespondentInput) : null;
  } catch {
    return null;
  }
}

export function PublicFormProvider({ children }: { children: ReactNode }) {
  const { formId } = useParamsTS<{ formId: string }>();
  // Pas de fragment ni de stockage au pre-rendu : le formulaire attend le navigateur.
  const [juryKey] = useState(() => (typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.slice(1))) || null);
  const [respondentInput, setRespondentState] = useState<RespondentInput | null>(() =>
    typeof window === "undefined" || !juryKey ? null : readStored(formId),
  );
  const { data, error, errorCode, isLoading, reload } = useCallable("getPublicForm", { formId, key: juryKey, respondent: respondentInput });

  const setRespondent = (next: RespondentInput | null) => {
    setRespondentState(next);
    // Seul un jure est retenu (un lien partage, souvent rouvert) ; un nom choisi se redemande.
    if (!juryKey) return;
    try {
      if (next) window.localStorage.setItem(storageKey(formId), JSON.stringify(next));
      else window.localStorage.removeItem(storageKey(formId));
    } catch {
      // Stockage refuse (navigation privee) : le nom sera redemande au rechargement.
    }
  };

  // Un rechargement (apres un envoi) garde la page affichee : seul le premier chargement attend.
  if (isLoading && !data) return <PageLoader />;
  if (!data) {
    if (errorCode === "functions/permission-denied") return <Empty>{error}</Empty>;
    return <BlockedState reason={errorCode === "functions/not-found" ? "not_found" : "error"} backHref={paths.home()} />;
  }
  return (
    <PublicFormContextProvider value={{ form: data, juryKey, respondentInput, setRespondent, reload }}>{children}</PublicFormContextProvider>
  );
}
