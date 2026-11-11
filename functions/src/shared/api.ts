// ----------------------------
// Adresses publiques de l'API et du serveur MCP
// ----------------------------
// Site Firebase Hosting `pioneers-hub-api` (firebase.json), reecrit vers la
// fonction `api`. Lues par le serveur (functions/src/api/config.ts, valeur de
// production) et par la page de documentation du front (/api-docs).

export const API_PUBLIC_URL = "https://pioneers-hub-api.web.app";
export const MCP_PUBLIC_URL = `${API_PUBLIC_URL}/mcp`;
export const OPENAPI_PUBLIC_URL = `${API_PUBLIC_URL}/v1/openapi.json`;

/** Longueur maximale du nom d'une cle d'API (callable `createApiKey`, champ de la page /api-docs). */
export const API_KEY_NAME_MAX = 80;
