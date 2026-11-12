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
import { API_KEY_NAME_MAX } from "./shared/api";
import { COL } from "./shared/collections";
import { isStaffViewer } from "./shared/access";
import type { ApiKey } from "./shared/types";
import { mintApiKey } from "./api/caller";
import { loadViewer } from "./api/viewer";
import { decideRequest, describeRequest } from "./oauth/consent";
import * as accounts from "./services/accounts";
import * as challenges from "./services/challenges";
import * as leaderboards from "./services/leaderboards";
import * as judges from "./services/judges";
import * as picks from "./services/picks";
import * as forms from "./services/forms";

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
// Cles d'API (tout compte connecte : `canUseApi`)
// ----------------------------
// Une cle agit avec les droits de son proprietaire (functions/src/services
// filtre chaque objet). Chacun gere les siennes ; le staff peut en revoquer
// n'importe laquelle.

async function assertStaff(uid: string | undefined): Promise<string> {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!isStaffViewer(await loadViewer(uid))) {
    throw new HttpsError("permission-denied", "Staff only.");
  }
  return uid;
}

/** Tout compte connecte peut avoir des cles (`canUseApi`) : un compte Firebase suffit. */
function assertSignedIn(uid: string | undefined): string {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  return uid;
}

export const createApiKey = onCallTyped("createApiKey", async (request) => {
  const uid = assertSignedIn(request.auth?.uid);
  const name = String(request.data?.name ?? "").trim();
  if (!name || name.length > API_KEY_NAME_MAX) {
    throw new HttpsError("invalid-argument", `\`name\` is required (${API_KEY_NAME_MAX} characters max).`);
  }

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
  const uid = assertSignedIn(request.auth?.uid);
  const keyId = String(request.data?.keyId ?? "");
  if (!keyId || keyId.includes("/")) throw new HttpsError("invalid-argument", "`keyId` is required.");
  const ref = getFirestore().doc(`${COL.apiKeys}/${keyId}`);
  const snap = await ref.get();
  // Une cle d'autrui est introuvable, sauf pour le staff.
  const mine = snap.exists && snap.get("ownerUid") === uid;
  if (!snap.exists || (!mine && !isStaffViewer(await loadViewer(uid)))) throw new HttpsError("not-found", "No such API key.");
  if (!snap.get("revokedDateISOString")) await ref.update({ revokedDateISOString: new Date().toISOString() });
  return { ok: true as const };
});

// ----------------------------
// Comptes et droits (Admin > Access, staff)
// ----------------------------

export const listAccounts = onCallTyped("listAccounts", async (request) => {
  await assertStaff(request.auth?.uid);
  return { accounts: await accounts.listAccounts() };
});

export const setAccountAccess = onCallTyped("setAccountAccess", async (request) => {
  const actorUid = await assertStaff(request.auth?.uid);
  const uid = String(request.data?.uid ?? "");
  if (!uid || uid.includes("/")) throw new HttpsError("invalid-argument", "`uid` is required.");
  await accounts.setAccountAccess(actorUid, uid, accounts.parseAccess(request.data ?? {}));
  return { ok: true as const };
});

export const inviteAccount = onCallTyped("inviteAccount", async (request) => {
  const actorUid = await assertStaff(request.auth?.uid);
  return accounts.inviteAccount(actorUid, String(request.data?.email ?? ""), accounts.parseAccess(request.data ?? {}));
});

export const setAccountDisabled = onCallTyped("setAccountDisabled", async (request) => {
  const actorUid = await assertStaff(request.auth?.uid);
  const uid = String(request.data?.uid ?? "");
  if (!uid || uid.includes("/")) throw new HttpsError("invalid-argument", "`uid` is required.");
  await accounts.setAccountDisabled(actorUid, uid, request.data?.disabled === true);
  return { ok: true as const };
});

// ----------------------------
// Debrief d'un hackathon (fondateur ; resultats aussi par le staff)
// ----------------------------

export const myChallengeTasks = onCallTyped("myChallengeTasks", async (request) => {
  const uid = assertSignedIn(request.auth?.uid);
  return { tasks: await challenges.myChallengeTasks(uid, request.data?.batchId) };
});

export const submitPeerRatings = onCallTyped("submitPeerRatings", async (request) => {
  const uid = assertSignedIn(request.auth?.uid);
  return { saved: await challenges.submitPeerRatings(uid, request.data?.eventId, request.data?.ratings) };
});

export const submitTeamResults = onCallTyped("submitTeamResults", async (request) => {
  const uid = assertSignedIn(request.auth?.uid);
  const { eventId, teamId, ...results } = request.data ?? {};
  await challenges.submitTeamResults(uid, eventId, teamId, results);
  return { ok: true as const };
});

export const setEventRanking = onCallTyped("setEventRanking", async (request) => {
  const actorUid = await assertStaff(request.auth?.uid);
  await leaderboards.setEventRanking(actorUid, request.data?.eventId, request.data?.metricKey);
  return { ok: true as const };
});

// ----------------------------
// Jury par lien prive : le staff cree et revoque ; le jure, sans compte, note
// ----------------------------

export const createJudge = onCallTyped("createJudge", async (request) => {
  const actorUid = await assertStaff(request.auth?.uid);
  return judges.createJudge(actorUid, request.data ?? {});
});

export const revokeJudge = onCallTyped("revokeJudge", async (request) => {
  const actorUid = await assertStaff(request.auth?.uid);
  await judges.revokeJudge(actorUid, request.data?.eventId, request.data?.judgeId);
  return { ok: true as const };
});

export const getJudgeSheet = onCallTyped("getJudgeSheet", (request) => judges.getJudgeSheet(request.data ?? {}));

export const submitJudgeScores = onCallTyped("submitJudgeScores", async (request) => {
  await judges.submitJudgeScores(request.data ?? {});
  return { ok: true as const };
});

// ----------------------------
// Choix prives d'un evenement (mutual picks, speed dating)
// ----------------------------

export const setEventPicks = onCallTyped("setEventPicks", async (request) => {
  const actorUid = await assertStaff(request.auth?.uid);
  await picks.setEventPicks(actorUid, request.data?.eventId, request.data?.picks);
  return { ok: true as const };
});

export const submitPicks = onCallTyped("submitPicks", async (request) => {
  const uid = assertSignedIn(request.auth?.uid);
  await picks.submitPicks(uid, request.data?.eventId, request.data?.pickedFounderIds);
  return { ok: true as const };
});

// ----------------------------
// Formulaires publics (page /forms/[formId], sans compte)
// ----------------------------
// Ouverts a tous : le repondant n'a pas de compte (SPECS §3.5). Connecte, son
// compte sert d'identite (fondateur rattache au batch).

export const getPublicForm = onCallTyped("getPublicForm", (request) =>
  forms.getPublicForm(request.auth?.uid ?? null, request.data?.formId),
);

export const submitFormResponse = onCallTyped("submitFormResponse", (request) =>
  forms.submitFormResponse(request.auth?.uid ?? null, request.data ?? {}),
);

/** Staff : valide ou refuse une valeur en attente d'une reponse. */
export const decideFormWrite = onCallTyped("decideFormWrite", async (request) =>
  forms.decideFormWrite(await assertStaff(request.auth?.uid), request.data ?? {}),
);

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
