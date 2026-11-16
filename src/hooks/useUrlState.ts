"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

// ----------------------------
// Un reglage de page garde dans l'URL (`?view=list&q=...`)
// ----------------------------
// Survit au rechargement et se partage avec le lien. Ecrit par
// `history.replaceState` : ni navigation ni nouvelle entree d'historique, et
// Next synchronise `useSearchParams` (docs : linking-and-navigating). La
// valeur par defaut et une valeur vide ne sont pas ecrites : l'URL reste nue
// tant que rien ne change.
// Une valeur hors de `allowed` (lien ancien ou modifie a la main) vaut le defaut.
// La page qui s'en sert est sous un `<Suspense>` (useSearchParams au prerendu).

export function useUrlState<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const raw = useSearchParams().get(key);
  const value = raw !== null && (!allowed || allowed.includes(raw as T)) ? (raw as T) : fallback;
  const setValue = useCallback(
    (next: T) => {
      const params = new URLSearchParams(window.location.search);
      if (next === fallback || next === "") params.delete(key);
      else params.set(key, next);
      const query = params.toString();
      window.history.replaceState(null, "",`${window.location.pathname}${query ? `?${query}` : ""}`);
    },
    [key, fallback],
  );
  return [value, setValue];
}
