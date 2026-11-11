import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

// ----------------------------
// api - les refus
// ----------------------------
// UNE erreur dit QUEL champ pose probleme (SPECS §4.7) et ce qu'il faut faire.
// « invalid request » ne vaut rien ; « `values.startup.icp` : trop long (4 000
// caracteres max) » vaut un tour de boucle pour un agent comme pour n8n.
//
// La meme enveloppe pour /v1 et pour le MCP : le MCP la recopie dans un
// resultat `isError` (mcp/reply.ts), /v1 la rend en JSON avec son statut.

type ApiErrorBody = {
  error: { code: string; message: string; field: string | null; requestId: string | null };
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field: string | null = null,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, field: string | null = null) =>
  new ApiError(400, code, message, field);
export const unauthorized = (code: string, message: string) => new ApiError(401, code, message);
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const notFound = (code: string, message: string, field: string | null = null) =>
  new ApiError(404, code, message, field);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

/** Le premier defaut d'un schema zod, avec le chemin du champ (`values.startup.icp`). */
export function fromZod(error: ZodError): ApiError {
  const issue = error.issues[0];
  const field = issue?.path.length ? issue.path.map(String).join(".") : null;
  return badRequest("invalid_request", field ? `\`${field}\`: ${issue.message}` : (issue?.message ?? "Invalid request."), field);
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) return fromZod(error);
  console.error("[api] unexpected error", error);
  return new ApiError(500, "internal", "Unexpected error. It has been logged.");
}

/** Gestionnaire Express : le dernier middleware de l'application. */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const apiError = toApiError(error);
  // Defi RFC 6750. Une surface protegee par OAuth (/mcp) a deja pose le sien,
  // qui pointe vers sa decouverte : on ne l'ecrase pas.
  if (apiError.status === 401 && !res.getHeader("WWW-Authenticate")) res.setHeader("WWW-Authenticate", 'Bearer realm="pioneers-hub"');
  const body: ApiErrorBody = {
    error: { code: apiError.code, message: apiError.message, field: apiError.field, requestId: req.requestId ?? null },
  };
  res.status(apiError.status).json(body);
}

/** Enveloppe une route asynchrone : une promesse rejetee va au gestionnaire. */
export const route =
  (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(next);
