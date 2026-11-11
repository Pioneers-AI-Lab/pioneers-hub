import type { ApiError } from "../api/errors";

// ----------------------------
// mcp - ce qu'un outil REND
// ----------------------------
// Une reponse d'outil entre dans une fenetre de contexte et s'y relit a chaque
// tour (repris de trippple `mcp/reply.js`) :
//   1. RIEN QUE DU SIGNAL : un champ nul est retire (un tableau vide reste :
//      « aucune note » est une reponse) ;
//   2. LE PLAFOND EST EN TAILLE, et on DIT qu'on a coupe ;
//   3. UNE ERREUR ORIENTE : code, champ fautif, et quoi faire.

// ~5 000 jetons : au-dela, un seul appel deciderait de ce que l'agent peut encore lire.
const MAX_RESULT_CHARS = 20000;

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null || child === undefined) continue;
    out[key] = compact(child);
  }
  return out;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export function toolResult(payload: unknown): ToolResult {
  const body = compact(payload) as Record<string, unknown>;
  let text = JSON.stringify(body);

  // Une liste trop longue se coupe par la fin, et le dit. Chaque element est
  // serialise une fois ; on garde ceux qui tiennent dans le plafond.
  if (text.length > MAX_RESULT_CHARS && Array.isArray(body.items)) {
    const items = body.items as unknown[];
    const room = MAX_RESULT_CHARS - (text.length - JSON.stringify(items).length) - 200;
    let used = 0;
    let kept = 0;
    for (const item of items) {
      used += JSON.stringify(item).length + 1;
      if (used > room) break;
      kept++;
    }
    kept = Math.max(kept, 1);
    text = JSON.stringify({ ...body, items: items.slice(0, kept), truncated: `${kept} of ${items.length} shown. Narrow with \`search\`.` });
  }
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}... [truncated: the object is larger than one reply]`;
  }
  return { content: [{ type: "text", text }] };
}

export function toolFailure(error: ApiError): ToolResult {
  const field = error.field ? ` (field: ${error.field})` : "";
  return { isError: true, content: [{ type: "text", text: `${error.code}: ${error.message}${field}` }] };
}
