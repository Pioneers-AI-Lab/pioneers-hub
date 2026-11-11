import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { COL } from "../shared/collections";
import type { OAuthClient, OAuthCode, OAuthGrant, OAuthRequest, OAuthToken } from "../shared/types";
import { secret, sha256 } from "../api/crypto";
import { FRONTEND_BASE_URL, MCP_URL, PROTECTED_RESOURCE_METADATA_PATH, PUBLIC_BASE_URL } from "../api/config";
import { ACCESS_PREFIX, REFRESH_PREFIX, TTL, isExpired, isoIn, redirectWith, sameResource } from "./store";

// ----------------------------
// oauth - le serveur d'autorisation du connecteur Claude
// ----------------------------
// OAuth 2.1, la forme que le connecteur claude.ai et Claude Code attendent
// (porte reduit de trippple `api/oauth`, ses `doc.md` portent les mesures) :
//
//   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 : qui signe les jetons de /mcp
//   GET  /.well-known/oauth-authorization-server       RFC 8414 : ou s'autoriser
//   POST /oauth/register                               RFC 7591 : enregistrement dynamique
//   GET  /oauth/authorize                              -> page de consentement du front
//   POST /oauth/token                                  code + PKCE (S256), rotation du rafraichissement
//
// ⛔️ CES ROUTES SONT PUBLIQUES ET MONTEES AVANT L'AUTHENTIFICATION : un client
// les lit justement parce qu'il n'a pas encore de justificatif (Trippple les a
// rendues en 401 pendant des jours).
//
// PAS DE PORTEES : un jeton porte l'IDENTITE ; les droits sont ceux du role,
// relus a chaque requete (`api/caller.ts`). La seule portee annoncee,
// `pioneers`, existe parce que des clients en exigent une.
//
// Clients PUBLICS (pas de secret client) : PKCE S256 obligatoire.

const SCOPE = "pioneers";

const oauthError = (res: Response, status: number, error: string, description: string) =>
  res.status(status).json({ error, error_description: description });

/** Les adresses de retour acceptees : https, ou la boucle locale (Claude Code). */
function isAllowedRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

const pkceS256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);

export const oauthRouter = Router();

// Les clients peuvent tourner dans un navigateur (inspecteur MCP) : ces routes repondent a toute origine.
oauthRouter.use(["/.well-known", "/oauth/register", "/oauth/token"], (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, mcp-protocol-version");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return void res.status(204).end();
  next();
});

// ---- Decouverte ------------------------------------------------------------------

const protectedResource = {
  resource: MCP_URL,
  authorization_servers: [PUBLIC_BASE_URL],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ["header"],
  resource_name: "Pioneers Hub",
};

const authorizationServer = {
  issuer: PUBLIC_BASE_URL,
  authorization_endpoint: `${PUBLIC_BASE_URL}/oauth/authorize`,
  token_endpoint: `${PUBLIC_BASE_URL}/oauth/token`,
  registration_endpoint: `${PUBLIC_BASE_URL}/oauth/register`,
  scopes_supported: [SCOPE],
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: ["none"],
  code_challenge_methods_supported: ["S256"],
};

oauthRouter.get(["/.well-known/oauth-protected-resource", PROTECTED_RESOURCE_METADATA_PATH], (_req, res) => {
  res.json(protectedResource);
});
// Certains clients cherchent la configuration OpenID : on leur rend la meme.
oauthRouter.get(["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"], (_req, res) => {
  res.json(authorizationServer);
});

// ---- Enregistrement (RFC 7591) -----------------------------------------------------

oauthRouter.post("/oauth/register", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(isAllowedRedirect)) {
    return oauthError(res, 400, "invalid_redirect_uri", "redirect_uris must be 1 to 10 https (or loopback http) URLs.");
  }
  const clientName = (str(body.client_name) ?? "MCP client").slice(0, 80);
  const ref = getFirestore().collection(COL.oauthClients).doc();
  const client: OAuthClient = { clientName, redirectUris, createdDateISOString: new Date().toISOString() };
  await ref.create(client);
  return res.status(201).json({
    client_id: ref.id,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_id_issued_at: Math.floor(Date.now() / 1000),
  });
});

// ---- Autorisation ------------------------------------------------------------------

oauthRouter.get("/oauth/authorize", async (req: Request, res: Response) => {
  const q = req.query as Record<string, unknown>;
  const clientId = str(q.client_id);
  const redirectUri = str(q.redirect_uri);
  const db = getFirestore();

  // Sans client ni adresse de retour valides, on ne redirige NULLE PART (RFC 6749 §4.1.2.1).
  const client = clientId ? ((await db.doc(`${COL.oauthClients}/${clientId}`).get()).data() as OAuthClient | undefined) : undefined;
  if (!client) return oauthError(res, 400, "invalid_client", "Unknown client_id. Register the client first.");
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return oauthError(res, 400, "invalid_request", "redirect_uri is not registered for this client.");
  }

  const state = str(q.state);
  const back = (error: string, description: string) =>
    res.redirect(302, redirectWith(redirectUri, state, { error, error_description: description }));

  if (q.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  const codeChallenge = str(q.code_challenge);
  if (!codeChallenge || q.code_challenge_method !== "S256") return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  const resource = str(q.resource) ?? MCP_URL;
  if (!sameResource(resource)) return back("invalid_target", `This server only issues tokens for ${MCP_URL}.`);

  const ref = db.collection(COL.oauthRequests).doc();
  const request: OAuthRequest = {
    clientId: clientId!,
    clientName: client.clientName,
    redirectUri,
    state,
    codeChallenge,
    resource: MCP_URL,
    status: "pending",
    uid: null,
    createdDateISOString: new Date().toISOString(),
    expiresDateISOString: isoIn(TTL.request),
  };
  await ref.create(request);
  return res.redirect(302, `${FRONTEND_BASE_URL}/oauth/consent?request=${ref.id}`);
});

// ---- Jetons ------------------------------------------------------------------------

function issueTokens(tx: FirebaseFirestore.Transaction, grantId: string, base: Pick<OAuthToken, "uid" | "clientId" | "resource">) {
  const db = getFirestore();
  const access = secret(ACCESS_PREFIX);
  const refresh = secret(REFRESH_PREFIX);
  const now = new Date().toISOString();
  const common = { ...base, grantId, usedDateISOString: null, createdDateISOString: now };
  tx.create(db.doc(`${COL.oauthTokens}/${sha256(access)}`), { ...common, kind: "access", expiresDateISOString: isoIn(TTL.access) } satisfies OAuthToken);
  tx.create(db.doc(`${COL.oauthTokens}/${sha256(refresh)}`), { ...common, kind: "refresh", expiresDateISOString: isoIn(TTL.refresh) } satisfies OAuthToken);
  return { access_token: access, token_type: "Bearer", expires_in: TTL.access / 1000, refresh_token: refresh, scope: SCOPE };
}

// Un refus est RENDU, pas jete : quand un code ou un rafraichissement est
// rejoue, la transaction ecrit la revocation PUIS refuse ; une exception
// annulerait cette ecriture.
type TokenResult = { body: Record<string, unknown> } | { error: string; description: string };

const fail = (error: string, description: string): TokenResult => ({ error, description });

async function exchangeCode(body: Record<string, unknown>): Promise<TokenResult> {
  const code = str(body.code);
  const verifier = str(body.code_verifier);
  const clientId = str(body.client_id);
  if (!code || !verifier || !clientId) return fail("invalid_request", "code, code_verifier and client_id are required.");
  const db = getFirestore();
  const codeRef = db.doc(`${COL.oauthCodes}/${sha256(code)}`);

  return db.runTransaction(async (tx): Promise<TokenResult> => {
    const doc = (await tx.get(codeRef)).data() as OAuthCode | undefined;
    if (!doc || doc.clientId !== clientId) return fail("invalid_grant", "Unknown or foreign authorization code.");
    if (doc.usedDateISOString) {
      // ⛔️ Un code rejoue a ete intercepte : l'autorisation qu'il a creee tombe avec lui.
      if (doc.grantId) tx.update(db.doc(`${COL.oauthGrants}/${doc.grantId}`), { revokedDateISOString: new Date().toISOString() });
      return fail("invalid_grant", "This authorization code was already used. The authorization has been revoked.");
    }
    if (isExpired(doc.expiresDateISOString)) return fail("invalid_grant", "This authorization code has expired.");
    if (str(body.redirect_uri) !== doc.redirectUri) return fail("invalid_grant", "redirect_uri does not match the authorization request.");
    if (pkceS256(verifier) !== doc.codeChallenge) return fail("invalid_grant", "code_verifier does not match code_challenge.");

    const grantRef = db.collection(COL.oauthGrants).doc();
    const grant: OAuthGrant = {
      uid: doc.uid,
      clientId,
      clientName: doc.clientName,
      resource: doc.resource,
      createdDateISOString: new Date().toISOString(),
      lastUsedDateISOString: null,
      revokedDateISOString: null,
    };
    tx.create(grantRef, grant);
    tx.update(codeRef, { usedDateISOString: new Date().toISOString(), grantId: grantRef.id });
    return { body: issueTokens(tx, grantRef.id, { uid: doc.uid, clientId, resource: doc.resource }) };
  });
}

async function refreshTokens(body: Record<string, unknown>): Promise<TokenResult> {
  const refresh = str(body.refresh_token);
  const clientId = str(body.client_id);
  if (!refresh || !clientId) return fail("invalid_request", "refresh_token and client_id are required.");
  const db = getFirestore();
  const tokenRef = db.doc(`${COL.oauthTokens}/${sha256(refresh)}`);

  return db.runTransaction(async (tx): Promise<TokenResult> => {
    const doc = (await tx.get(tokenRef)).data() as OAuthToken | undefined;
    if (!doc || doc.kind !== "refresh" || doc.clientId !== clientId) return fail("invalid_grant", "Unknown refresh token.");
    const grantRef = db.doc(`${COL.oauthGrants}/${doc.grantId}`);
    const grant = (await tx.get(grantRef)).data() as OAuthGrant | undefined;
    if (!grant || grant.revokedDateISOString) return fail("invalid_grant", "This authorization has been revoked. Connect again.");
    if (doc.usedDateISOString) {
      // ⛔️ ROTATION : un rafraichissement deja echange qui revient a ete vole. On coupe tout.
      tx.update(grantRef, { revokedDateISOString: new Date().toISOString() });
      return fail("invalid_grant", "This refresh token was already used. The authorization has been revoked.");
    }
    if (isExpired(doc.expiresDateISOString)) return fail("invalid_grant", "This refresh token has expired. Connect again.");

    tx.update(tokenRef, { usedDateISOString: new Date().toISOString() });
    return { body: issueTokens(tx, doc.grantId, { uid: doc.uid, clientId, resource: doc.resource }) };
  });
}

oauthRouter.post("/oauth/token", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result =
    body.grant_type === "authorization_code"
      ? await exchangeCode(body)
      : body.grant_type === "refresh_token"
        ? await refreshTokens(body)
        : fail("unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
  res.setHeader("Pragma", "no-cache");
  if ("body" in result) return res.json(result.body);
  return oauthError(res, 400, result.error, result.description);
});
