import type { NextFunction, Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { COL } from "../shared/collections";
import { canUseApi, type Viewer } from "../shared/access";
import type { ApiKey, AuditSource } from "../shared/types";
import { ACCESS_PREFIX, resolveAccessToken } from "../oauth/store";
import { secret, sha256 } from "./crypto";
import { forbidden, unauthorized } from "./errors";
import { touchLastUsed } from "./lastUsed";
import { loadViewer } from "./viewer";

// ----------------------------
// api - QUI appelle
// ----------------------------
// Tous les justificatifs se resolvent vers la MEME forme, `Caller`, et rien en
// aval ne sait par lequel l'appelant est entre : c'est ce qui empeche /v1 et le
// MCP de diverger (lecon de Trippple, `api/index.js`).
//
//   ph_live_...   cle d'API nominative (n8n, Zapier, scripts) : droits de son proprietaire
//   pha_...       jeton OAuth du connecteur Claude (oauth/), pour /mcp seulement (son audience)
//   ID token      jeton Firebase de la personne connectee (UI, tests)
//
// PAS DE PORTEES. Les droits sont ceux du ROLE (SPECS §4.7), relus a chaque
// requete dans `users/{uid}` : retirer `staff` a quelqu'un coupe sa cle et son
// connecteur a la requete suivante. Qui peut entrer : `canUseApi` (shared/access.ts).

export type Caller = {
  uid: string;
  viewer: Viewer;
  /** Source inscrite au journal d'audit. */
  via: Extract<AuditSource, "api" | "mcp">;
  apiKeyId: string | null;
};

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    caller?: Caller;
  }
}

const API_KEY_PREFIX = "ph_live_";

/** Une cle neuve : la valeur en clair (montree une fois), son prefixe affiche et son empreinte. */
export function mintApiKey(): { key: string; prefix: string; keyHash: string } {
  const key = secret(API_KEY_PREFIX);
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 4), keyHash: sha256(key) };
}

type Resolved = { uid: string; apiKeyId: string | null; viewer: Viewer };

async function callerFromApiKey(key: string): Promise<Resolved> {
  const found = await getFirestore().collection(COL.apiKeys).where("keyHash", "==", sha256(key)).limit(1).get();
  const doc = found.docs[0];
  if (!doc) throw unauthorized("invalid_api_key", "This API key does not exist.");
  const apiKey = doc.data() as ApiKey;
  if (apiKey.revokedDateISOString) throw unauthorized("revoked_api_key", "This API key has been revoked.");
  touchLastUsed(doc.ref, apiKey.lastUsedDateISOString);
  return { uid: apiKey.ownerUid, apiKeyId: doc.id, viewer: await loadViewer(apiKey.ownerUid) };
}

async function callerFromIdToken(token: string): Promise<Resolved> {
  let uid: string;
  try {
    uid = (await getAuth().verifyIdToken(token, true)).uid;
  } catch {
    throw unauthorized("invalid_token", "The bearer token is invalid or expired.");
  }
  return { uid, apiKeyId: null, viewer: await loadViewer(uid) };
}

async function callerFromOAuth(token: string, via: Caller["via"]): Promise<Resolved> {
  // RFC 8707 : le jeton a ete emis pour /mcp ; /v1 se sert d'une cle d'API.
  if (via !== "mcp") throw unauthorized("wrong_audience", "OAuth tokens are for /mcp. Use an API key (`ph_live_...`) for /v1.");
  const resolved = await resolveAccessToken(token);
  if (!resolved) throw unauthorized("invalid_token", "The access token is invalid, expired or revoked.");
  return { ...resolved, apiKeyId: null };
}

function bearerOf(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  const apiKey = req.headers["x-api-key"];
  return typeof apiKey === "string" && apiKey ? apiKey : null;
}

/** Resout l'appelant et exige qu'il puisse se servir de l'API (`canUseApi`). */
async function resolveCaller(req: Request, via: Caller["via"]): Promise<Caller> {
  const token = bearerOf(req);
  if (!token) throw unauthorized("missing_credentials", "Send `Authorization: Bearer <API key or token>`.");

  const { uid, apiKeyId, viewer } = token.startsWith(API_KEY_PREFIX)
    ? await callerFromApiKey(token)
    : token.startsWith(ACCESS_PREFIX)
      ? await callerFromOAuth(token, via)
      : await callerFromIdToken(token);

  if (!canUseApi(viewer)) throw forbidden("staff_only", "The Pioneers Hub API is open to staff accounts only for now.");
  return { uid, viewer, via, apiKeyId };
}

/** Middleware : pose `req.caller`. */
export const requireCaller =
  (via: Caller["via"]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    resolveCaller(req, via)
      .then((caller) => {
        req.caller = caller;
        next();
      })
      .catch(next);
  };
