import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Caller } from "../api/caller";
import { FRONTEND_BASE_URL, PUBLIC_BASE_URL } from "../api/config";
import { notFound, toApiError } from "../api/errors";
import { toolsFor } from "./catalogue";
import { INSTRUCTIONS } from "./instructions";
import { toolFailure, toolResult } from "./reply";

// ----------------------------
// mcp - le serveur
// ----------------------------
// Serveur BAS NIVEAU (`Server`, pas `McpServer`), comme Trippple : le schema
// d'entree de chaque outil est le JSON Schema tire du contrat zod, et l'on
// garde la main sur la traduction des refus.
//
// UN REFUS METIER SORT EN RESULTAT `isError`, pas en exception du protocole :
// l'agent le lit, corrige, et reste dans sa boucle. Les refus d'AUTHENTIFICATION,
// eux, sortent en HTTP 401 avant le transport (mcp/index.ts).

// L'icone que Claude affiche dans sa liste de connecteurs (revision 2025-11-25
// du protocole). Sans elle, il montre une icone generique. Servie en HTTPS par
// le site Hosting (api-hosting/, fichiers statiques), sans redirection, comme
// l'exige le protocole ; le meme symbole sert de favicon au domaine.
const SERVER_INFO = {
  name: "pioneers-hub",
  title: "Pioneers Hub",
  version: "0.1.0",
  description: "Read and fill the Pioneers batch database: founders, startups, events, notes.",
  websiteUrl: FRONTEND_BASE_URL,
  icons: [{ src: `${PUBLIC_BASE_URL}/icon.png`, mimeType: "image/png", sizes: ["192x192"] }],
};

export function createServer(caller: Caller): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  const tools = toolsFor(caller);
  const byName = new Map(tools.map((t) => [t.name, t]));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((t) => t.declaration) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return toolFailure(notFound("unknown_tool", `No tool \`${request.params.name}\`. Tools: ${tools.map((t) => t.name).join(", ")}.`));
    }
    try {
      return toolResult(await tool.run(caller, (request.params.arguments ?? {}) as Record<string, unknown>));
    } catch (error) {
      return toolFailure(toApiError(error));
    }
  });

  return server;
}
