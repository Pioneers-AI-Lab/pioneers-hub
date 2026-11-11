// ----------------------------
// Cloud Functions de Pioneers Hub
// ----------------------------
// Region `europe-west4` (RGPD : hebergement UE). Chaque callable est declaree
// dans shared/callables.ts, puis implementee ici avec `onCallTyped`, pour que
// le nom et les types restent ceux que le front appelle.

import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, type CallableRequest as FirebaseCallableRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { FUNCTIONS_REGION, type CallableName, type CallableRequest, type CallableResponse } from "./shared/callables";

initializeApp();
setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 10 });

function onCallTyped<K extends CallableName>(
  _name: K,
  handler: (request: FirebaseCallableRequest<CallableRequest<K>>) => Promise<CallableResponse<K>> | CallableResponse<K>,
) {
  return onCall<CallableRequest<K>, Promise<CallableResponse<K>>>(async (request) => handler(request));
}

export const health = onCallTyped("health", (request) => ({
  ok: true,
  region: FUNCTIONS_REGION,
  uid: request.auth?.uid ?? null,
}));
