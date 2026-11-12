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

/** Le jour a Paris, `YYYY-MM-DD`, d'un instant ISO (le serveur tourne en UTC). */
export const parisDay = (iso: string) => PARIS_DAY.format(new Date(iso));

/** Le lundi (`YYYY-MM-DD`) de la semaine de l'instant `iso`, a Paris (logique partagee avec le front). */
export { parisMonday } from "../shared/formRules";

/** Le jour a Paris, `YYYY-MM-DD` (le serveur tourne en UTC). */
export const parisToday = () => PARIS_DAY.format(new Date());

/** La fin (23:59:59, heure de Paris, heure d'ete comprise) du jour qui suit l'instant `iso`. */
export function parisEndOfNextDay(iso: string): string {
  const next = new Date(`${parisDay(iso)}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "longOffset" })
      .formatToParts(next)
      .find((p) => p.type === "timeZoneName")
      ?.value.replace("GMT", "") || "Z";
  return new Date(`${next.toISOString().slice(0, 10)}T23:59:59${offset}`).toISOString();
}
