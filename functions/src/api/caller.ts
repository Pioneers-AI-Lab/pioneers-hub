import type { NextFunction, Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { COL } from "../shared/collections";
import { canUseApi } from "../shared/access";
import type { ApiKey, AuditSource } from "../shared/types";
import { ACCESS_PREFIX, resolveAccessToken } from "../oauth/store";
import { secret, sha256 } from "./crypto";
import { forbidden, unauthorized } from "./errors";
import { touchLastUsed } from "./lastUsed";
import { loadAccount, type Account } from "./viewer";

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
// connecteur a la requete suivante. Qui peut entrer : `canUseApi` (shared/access.ts) ;
// ce que chacun voit et ecrit : `services/` applique shared/access.ts a chaque objet.

export type Caller = Account & {
  uid: string;
  /**
   * Source inscrite au journal d'audit. `function` : une ecriture faite par le
   * serveur pour un tiers (reponse de formulaire) ; `ui` : une action de
   * l'interface (callable), avec les droits du compte connecte.
   */
  via: Extract<AuditSource, "api" | "mcp" | "function" | "ui">;
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

type Resolved = Account & { apiKeyId: string | null };

async function callerFromApiKey(key: string): Promise<Resolved> {
  const found = await getFirestore().collection(COL.apiKeys).where("keyHash", "==", sha256(key)).limit(1).get();
  const doc = found.docs[0];
  if (!doc) throw unauthorized("invalid_api_key", "This API key does not exist.");
  const apiKey = doc.data() as ApiKey;
  if (apiKey.revokedDateISOString) throw unauthorized("revoked_api_key", "This API key has been revoked.");
  touchLastUsed(doc.ref, apiKey.lastUsedDateISOString);
  return { apiKeyId: doc.id, ...(await loadAccount(apiKey.ownerUid)) };
}

/** L'appelant d'une callable de l'interface : le compte connecte, ses droits relus. */
export async function uiCaller(uid: string): Promise<Caller> {
  return { ...(await loadAccount(uid)), uid, via: "ui", apiKeyId: null };
}

async function callerFromIdToken(token: string): Promise<Resolved> {
  let uid: string;
  try {
    uid = (await getAuth().verifyIdToken(token, true)).uid;
  } catch {
    throw unauthorized("invalid_token", "The bearer token is invalid or expired.");
  }
  return { apiKeyId: null, ...(await loadAccount(uid)) };
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

  const resolved = token.startsWith(API_KEY_PREFIX)
    ? await callerFromApiKey(token)
    : token.startsWith(ACCESS_PREFIX)
      ? await callerFromOAuth(token, via)
      : await callerFromIdToken(token);

  // `canUseApi` : la politique d'acces, en un seul point (tout compte connecte aujourd'hui).
  if (!canUseApi(resolved.viewer)) throw forbidden("not_allowed", "This account cannot use the Pioneers Hub API.");
  return { ...resolved, uid: resolved.viewer.uid, via };
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
