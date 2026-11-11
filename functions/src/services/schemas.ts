import { z } from "zod";

// ----------------------------
// services - briques de schema partagees par les operations
// ----------------------------

/** Le JSON Schema d'ENTREE d'un contrat zod : celui des outils MCP et de la spec OpenAPI. */
export function toInputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Jour calendaire `YYYY-MM-DD`, et un vrai jour (`2026-13-45` est refuse). */
export const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "not a real date");

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** Le jour a Paris, `YYYY-MM-DD` (le serveur tourne en UTC). */
export const parisToday = () => PARIS_DAY.format(new Date());
