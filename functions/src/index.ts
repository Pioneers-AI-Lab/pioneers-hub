// ----------------------------
// Cloud Functions de Pioneers Hub
// ----------------------------
// Region `europe-west4` (RGPD : hebergement UE). Chaque callable est declaree
// dans shared/callables.ts, puis implementee ici avec `onCallTyped`, pour que
// le nom et les types restent ceux que le front appelle.

import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest, type CallableRequest as FirebaseCallableRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { FUNCTIONS_REGION, type CallableName, type CallableRequest, type CallableResponse } from "./shared/callables";
import { COL } from "./shared/collections";
import { isStaffViewer } from "./shared/access";
import type { ApiKey } from "./shared/types";
import { mintApiKey } from "./api/caller";
import { loadViewer } from "./api/viewer";
import { decideRequest, describeRequest } from "./oauth/consent";

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

// ----------------------------
// API HTTP et serveur MCP (functions/src/api, functions/src/mcp)
// ----------------------------
// Servie par le site Hosting `pioneers-hub-api` : https://pioneers-hub-api.web.app/v1 et /mcp.
// `invoker: "public"` : l'authentification est celle de l'API (cle ou jeton),
// pas celle de Cloud Run. 60 s : la limite d'une reecriture Hosting.
// L'application (Express, SDK MCP, schemas) se charge a la premiere requete :
// les callables, deployees depuis le meme code, ne la paient pas a froid.
let apiApp: Promise<typeof import("./api/app")> | null = null;
export const api = onRequest({ invoker: "public", timeoutSeconds: 60, memory: "512MiB" }, async (req, res) => {
  const { app } = await (apiApp ??= import("./api/app"));
  app(req, res);
});

// ----------------------------
// Cles d'API (staff)
// ----------------------------

async function assertStaff(uid: string | undefined): Promise<string> {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!isStaffViewer(await loadViewer(uid))) {
    throw new HttpsError("permission-denied", "Staff only.");
  }
  return uid;
}

export const createApiKey = onCallTyped("createApiKey", async (request) => {
  const uid = await assertStaff(request.auth?.uid);
  const name = String(request.data?.name ?? "").trim();
  if (!name || name.length > 80) throw new HttpsError("invalid-argument", "`name` is required (80 characters max).");

  const { key, prefix, keyHash } = mintApiKey();
  const ref = getFirestore().collection(COL.apiKeys).doc();
  const doc: ApiKey = {
    ownerUid: uid,
    name,
    prefix,
    keyHash,
    createdDateISOString: new Date().toISOString(),
    lastUsedDateISOString: null,
    revokedDateISOString: null,
  };
  await ref.create(doc);
  return { keyId: ref.id, key, prefix };
});

export const revokeApiKey = onCallTyped("revokeApiKey", async (request) => {
  await assertStaff(request.auth?.uid);
  const keyId = String(request.data?.keyId ?? "");
  if (!keyId || keyId.includes("/")) throw new HttpsError("invalid-argument", "`keyId` is required.");
  const ref = getFirestore().doc(`${COL.apiKeys}/${keyId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "No such API key.");
  if (!snap.get("revokedDateISOString")) await ref.update({ revokedDateISOString: new Date().toISOString() });
  return { ok: true as const };
});

// ----------------------------
// Consentement OAuth du connecteur Claude (page /oauth/consent du front)
// ----------------------------

export const oauthDescribeRequest = onCallTyped("oauthDescribeRequest", async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  return describeRequest(request.auth.uid, String(request.data?.requestId ?? ""));
});

export const oauthDecide = onCallTyped("oauthDecide", async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  return decideRequest(request.auth.uid, String(request.data?.requestId ?? ""), request.data?.approve === true);
});
