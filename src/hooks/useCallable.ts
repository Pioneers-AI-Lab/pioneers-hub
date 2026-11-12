"use client";

import { useCallback, useEffect, useState } from "react";
import type { CallableName, CallableRequest, CallableResponse } from "@shared/callables";
import { useAuth } from "@/context/AuthContext";
import { call } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";

/**
 * Une LECTURE par callable (quand les regles ne laissent pas lire les documents
 * directement, ou qu'un seul appel vaut mieux que dix ecouteurs). Pas de temps
 * reel : `reload()` apres une ecriture.
 *
 * `data` : `undefined` tant que la reponse n'est pas la ; apres une erreur, il
 * reste `undefined`, `error` porte le message et `errorCode` le code
 * (`functions/not-found`...). La requete est comparee par valeur (JSON) : un
 * objet recree a chaque rendu ne relance pas l'appel.
 *
 * Le jeton du compte connecte part avec l'appel : on attend de savoir qui est
 * connecte, et l'appel se relance quand le compte change. `enabled: false`
 * attend en plus une condition de l'appelant.
 */
export function useCallable<K extends CallableName>(
  name: K,
  req: CallableRequest<K>,
  { enabled: callerEnabled = true }: { enabled?: boolean } = {},
) {
  const { firebaseUser, isLoading: isAuthLoading } = useAuth();
  const enabled = callerEnabled && !isAuthLoading;
  const scope = firebaseUser?.uid ?? "";
  const [state, setState] = useState<{ data?: CallableResponse<K>; error: string | null; errorCode: string | null; key: string } | null>(
    null,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const reqKey = JSON.stringify(req);
  const scopeKey = `${scope}|${reqKey}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const key = `${scopeKey}#${reloadKey}`;
    call(name)(JSON.parse(reqKey) as CallableRequest<K>)
      .then(({ data }) => !cancelled && setState({ data, error: null, errorCode: null, key }))
      .catch(
        (err: unknown) =>
          !cancelled && setState({ error: errorMessage(err), errorCode: (err as { code?: string }).code ?? null, key }),
      );
    return () => {
      cancelled = true;
    };
  }, [name, reqKey, scopeKey, reloadKey, enabled]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  // Une reponse a une autre requete ne s'affiche pas pour celle-ci ; un rechargement garde l'ancienne.
  const current = enabled && state && state.key.startsWith(`${scopeKey}#`) ? state : null;
  return {
    data: current?.data,
    error: current?.error ?? null,
    errorCode: current?.errorCode ?? null,
    isLoading: current === null,
    reload,
  };
}
