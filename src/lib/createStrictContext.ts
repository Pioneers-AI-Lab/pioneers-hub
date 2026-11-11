"use client";

import { createContext, useContext } from "react";

/**
 * Contexte sans valeur par defaut : son hook leve une erreur s'il est appele
 * hors de son Provider. Chez Trippple, chaque contexte avait une valeur par
 * defaut (`business: null`, `isLoading: true`) ; un composant monte au mauvais
 * endroit affichait un chargement eternel au lieu de dire ou etait l'erreur.
 *
 *   const [BatchContextProvider, useBatch] = createStrictContext<BatchValue>("Batch");
 */
export function createStrictContext<T>(name: string) {
  const Context = createContext<T | null>(null);
  Context.displayName = `${name}Context`;

  function useStrictContext(): T {
    const value = useContext(Context);
    if (value === null) {
      throw new Error(`use${name}() doit etre appele sous <${name}Provider> (voir le layout du niveau).`);
    }
    return value;
  }

  return [Context.Provider, useStrictContext] as const;
}
