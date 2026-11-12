import { HttpsError } from "firebase-functions/v2/https";
import { FORM_ANSWER_MAX } from "../shared/formRules";
import { normalizeHttpUrl } from "../shared/text";

// ----------------------------
// services - nettoyage des entrees des callables
// ----------------------------
// Texte coupe a ses espaces (vide -> `null`), adresse web completee de
// `https://` si besoin, id de document sans `/`. Une entree refusee leve une
// `invalid-argument` qui nomme le champ.

/** Une entree refusee, qui nomme le champ : « `label`: message ». */
export const invalidArgument = (label: string, message: string) => new HttpsError("invalid-argument", `\`${label}\`: ${message}`);

export function cleanId(value: unknown, label: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.includes("/") || id.length > 200) throw invalidArgument(label, "required.");
  return id;
}

export function cleanText(value: unknown, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalidArgument(label, "expected text.");
  const text = value.trim();
  if (text.length > max) throw invalidArgument(label, `${max} characters at most.`);
  return text || null;
}

export function cleanUrl(value: unknown, label: string): string | null {
  const text = cleanText(value, FORM_ANSWER_MAX.link, label);
  if (text === null) return null;
  const url = normalizeHttpUrl(text);
  if (!url) throw invalidArgument(label, "expected a web address.");
  return url;
}
