import { getFirestore } from "firebase-admin/firestore";
import { COL } from "../shared/collections";
import type { Viewer } from "../shared/access";
import type { OAuthGrant, OAuthToken } from "../shared/types";
import { sha256 } from "../api/crypto";
import { MCP_URL } from "../api/config";
import { touchLastUsed } from "../api/lastUsed";
import { loadViewer } from "../api/viewer";

// ----------------------------
// oauth - durees, regles communes, et lecture d'un jeton
// ----------------------------
// Un secret (code, jeton) ne vit en base que par son EMPREINTE : l'id du
// document est `sha256(secret)`. Une fuite de la base ne livre aucun jeton.

export const ACCESS_PREFIX = "pha_";
export const REFRESH_PREFIX = "phr_";

export const TTL = {
  request: 10 * 60 * 1000,
  code: 5 * 60 * 1000,
  access: 60 * 60 * 1000,
  refresh: 30 * 24 * 60 * 60 * 1000,
} as const;

export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();

export const isExpired = (iso: string) => Date.parse(iso) <= Date.now();

/** La ressource est TOUJOURS ce serveur MCP (RFC 8707) : un jeton pour une autre adresse n'ouvre rien. */
export const sameResource = (value: string) => value.replace(/\/+$/, "") === MCP_URL;

/** L'adresse de retour du client, avec ses parametres et l'etat qu'il a envoye (code, ou refus). */
export function redirectWith(redirectUri: string, state: string | null, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Un jeton d'acces valide : son compte et ses droits, ou `null`.
 * Sur le chemin de CHAQUE requete /mcp (le transport est sans etat) : le jeton
 * d'abord (il nomme l'autorisation et le compte), puis les deux ensemble.
 */
export async function resolveAccessToken(token: string): Promise<{ uid: string; viewer: Viewer } | null> {
  const db = getFirestore();
  const doc = (await db.doc(`${COL.oauthTokens}/${sha256(token)}`).get()).data() as OAuthToken | undefined;
  if (!doc || doc.kind !== "access" || isExpired(doc.expiresDateISOString) || !sameResource(doc.resource)) return null;

  const grantRef = db.doc(`${COL.oauthGrants}/${doc.grantId}`);
  const [grantSnap, viewer] = await Promise.all([grantRef.get(), loadViewer(doc.uid)]);
  const grant = grantSnap.data() as OAuthGrant | undefined;
  if (!grant || grant.revokedDateISOString) return null;

  touchLastUsed(grantRef, grant.lastUsedDateISOString);
  return { uid: doc.uid, viewer };
}
