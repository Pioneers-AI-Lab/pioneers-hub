import { z } from "zod";

// ----------------------------
// services - briques de schema partagees par les operations
// ----------------------------

/** Le JSON Schema d'ENTREE d'un contrat zod : celui des outils MCP et de la spec OpenAPI. */
export function toInputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    io: "input",
    // ⛔️ Le catalogue MCP se relit a chaque tour : on n'y met que ce qui guide
    // le modele. La regex d'une date ISO (~150 jetons par champ) et les bornes
    // par defaut d'un entier n'apprennent rien que `format` et le type ne
    // disent deja ; le serveur valide de toute facon avec zod.
    override: (ctx) => {
      const js = ctx.jsonSchema as Record<string, unknown>;
      if (js.format === "date-time") delete js.pattern;
      if (js.minimum === Number.MIN_SAFE_INTEGER) delete js.minimum;
      if (js.maximum === Number.MAX_SAFE_INTEGER) delete js.maximum;
    },
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Un instant ISO 8601 avec fuseau, rendu en UTC (`...Z`) : la forme de tous les `...DateISOString`. */
export const isoDateTime = z.iso
  .datetime({ offset: true })
  .transform((d) => new Date(d).toISOString())
  .describe("ISO 8601 with a time zone, e.g. 2026-11-19T15:00:00+01:00.");

/** Jour calendaire `YYYY-MM-DD`, et un vrai jour (`2026-13-45` est refuse). */
export const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "not a real date");

// Jours a Paris : logique pure (`Intl`), dans shared/dates.ts.
export { parisDay, parisToday } from "../shared/dates";

