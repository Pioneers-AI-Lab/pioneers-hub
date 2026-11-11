import { Router, type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { requireCaller } from "../api/caller";
import { PROTECTED_RESOURCE_METADATA_PATH, PUBLIC_BASE_URL } from "../api/config";
import { ApiError } from "../api/errors";
import { createServer } from "./server";

// ----------------------------
// mcp - le montage
// ----------------------------
// SUR L'APPLICATION DE L'API, pour partager le CABLAGE (identifiant de requete,
// authentification, gestionnaire d'erreur) : c'est la que vivent les defauts,
// et il n'y a qu'une pile ou les trouver (lecon de Trippple, `mcp/index.js`).
//
// TRANSPORT SANS ETAT : un serveur et un transport NEUFS par requete, une
// reponse JSON plutot qu'un flux. Rien ne dure entre deux instances, et aucun
// outil n'attend : derriere Firebase Hosting, une requete a 60 s.

const PROTOCOL_VERSION = "mcp-protocol-version";

/**
 * Retire `MCP-Protocol-Version` quand le SDK ne connait pas la valeur.
 *
 * ⛔️ PANNE TOTALE CHEZ TRIPPPLE LE 2026-09-28 : un client a annonce une
 * revision plus recente que le SDK, qui rend alors 400 a chaque requete - et
 * cote agent ca se lit « aucun outil disponible ». Sans session, l'en-tete ne
 * peut que refuser. Le transport relit `rawHeaders` (conversion en requete Web) :
 * on reconstruit ce tableau, `req.headers` ne suffit pas.
 */
function stripUnknownProtocolVersion(req: Request) {
  const value = req.headers[PROTOCOL_VERSION];
  if (typeof value === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(value)) return;
  delete req.headers[PROTOCOL_VERSION];
  const kept: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === PROTOCOL_VERSION) continue;
    kept.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }
  req.rawHeaders = kept;
}

export const mcpRouter = Router();

mcpRouter.use(requireCaller("mcp"));

// Sur /mcp, un refus d'authentification nomme la decouverte OAuth (RFC 9728) :
// c'est ainsi qu'un client MCP sans justificatif trouve ou se connecter. Le
// gestionnaire general de l'application rend ensuite l'erreur.
mcpRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof ApiError && error.status === 401) {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${PUBLIC_BASE_URL}${PROTECTED_RESOURCE_METADATA_PATH}"`);
  }
  next(error);
});

mcpRouter.all("/", async (req, res, next) => {
  stripUnknownProtocolVersion(req);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  // Sans ceci, un refus du transport ne laisse que son code HTTP.
  transport.onerror = (error) => console.error(`[mcp] transport requestId=${req.requestId} refused:`, error);

  const server = createServer(req.caller!);
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    // Le corps est deja analyse : le relire depuis le flux rendrait une requete vide.
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    next(error);
  }
});
