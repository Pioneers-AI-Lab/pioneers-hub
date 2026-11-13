"use client";

import { useMemo, useSyncExternalStore } from "react";

// ----------------------------
// Formulaires anonymes envoyes depuis CET appareil, par fondateur
// ----------------------------
// Le serveur ne rattache jamais une reponse anonyme a son auteur (pas de
// `formCompletions`) : c'est le navigateur qui s'en souvient, pour retirer le
// formulaire du « To do ». Commodite locale seulement : sur un autre appareil,
// ou apres effacement des donnees du site, le formulaire reapparait jusqu'a sa
// fermeture. Une cle par fondateur : sur un appareil partage, l'envoi de l'un ne
// retire rien du « To do » de l'autre. `storage` : un envoi dans un autre onglet
// met le « To do » a jour.

const keyOf = (founderId: string) => `pioneers:anonymousFormsDone:${founderId}`;

const listeners = new Set<() => void>();

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function parse(raw: string): string[] {
  try {
    const ids: unknown = JSON.parse(raw || "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Apres l'envoi d'un formulaire anonyme par un fondateur connecte (components/forms/TypeForm). */
export function markAnonymousFormDone(founderId: string, formId: string) {
  const key = keyOf(founderId);
  try {
    const ids = new Set(parse(read(key))).add(formId);
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Stockage bloque (navigation privee) : le formulaire restera dans le « To do ».
  }
  listeners.forEach((listener) => listener());
}

/** Les ids des formulaires anonymes que ce fondateur a envoyes depuis ce navigateur (vide au pre-rendu). */
export function useAnonymousFormsDone(founderId: string): ReadonlySet<string> {
  const key = keyOf(founderId);
  const raw = useSyncExternalStore(subscribe, () => read(key), () => "");
  return useMemo(() => new Set(parse(raw)), [raw]);
}
