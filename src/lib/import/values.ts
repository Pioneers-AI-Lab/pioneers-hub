import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import type { ValueSpec } from "@shared/fieldRegistry";
import type { ImportFieldKey } from "./targets";

dayjs.extend(customParseFormat);

// ----------------------------
// Import CSV : d'une cellule a une valeur typee
// ----------------------------
// Chaque champ du registre dit quelle valeur il accepte (`ValueSpec`). Une
// cellule vide donne `null` (rien a ecrire) ; une cellule illisible donne une
// erreur affichee dans l'apercu, et la valeur n'est pas ecrite.

export type Converted = { ok: true; value: unknown } | { ok: false; reason: string };

const EMPTY = { ok: true, value: null } as const;

/** Listes Airtable et Google Forms : virgules, points-virgules ou retours a la ligne. */
const splitList = (raw: string) =>
  raw
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

function parseBoolean(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (/^(yes|y|true|oui|1|x|checked)\b/.test(v)) return true;
  if (/^(no|n|false|non|0|unchecked|none)\b/.test(v)) return false;
  return null;
}

/** `YYYY-MM-DD`, `DD/MM/YYYY` (formulaires europeens), `M/D/YYYY` si le jour depasse 12. */
function parseDay(raw: string): string | null {
  const v = raw.trim();
  const iso = dayjs(v, ["YYYY-MM-DD", "YYYY-MM-DDTHH:mm:ss.SSSZ", "YYYY/MM/DD"], true);
  if (iso.isValid()) return iso.format("YYYY-MM-DD");
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const [a, b, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [day, month] = b > 12 ? [b, a] : [a, b];
  const d = dayjs(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, "YYYY-MM-DD", true);
  return d.isValid() ? d.format("YYYY-MM-DD") : null;
}

/** Champs dont les valeurs fermees ont une forme lisible a traduire. */
function special(field: ImportFieldKey, raw: string): Converted | null {
  const v = raw.trim().toLowerCase();
  if (field === "founderDirectory.hasExistingCoFounders") {
    if (/outside|external|hors/.test(v)) return { ok: true, value: "outside_batch" };
    if (/^(no|non|none)\b/.test(v)) return { ok: true, value: "none" };
    if (/yes|oui|in the batch|batch/.test(v)) return { ok: true, value: "in_batch" };
    return { ok: false, reason: `"${raw}" is not in the batch / outside / none` };
  }
  if (field === "founder.profileCategory") {
    if (/hybrid/.test(v)) return { ok: true, value: "hybrid" };
    if (/tech/.test(v)) return { ok: true, value: "technical" };
    if (/bus|biz/.test(v)) return { ok: true, value: "business" };
    return { ok: false, reason: `"${raw}" is not Tech, Business or Hybrid` };
  }
  return null;
}

export function convertCell(field: ImportFieldKey, spec: ValueSpec, raw: string | undefined): Converted {
  if (raw === undefined || raw.trim() === "") return EMPTY;
  const value = raw.trim();
  const custom = special(field, value);
  if (custom) return custom;

  switch (spec.kind) {
    case "text":
      return { ok: true, value: spec.maxLength ? value.slice(0, spec.maxLength) : value };
    case "url":
    case "phone":
      return { ok: true, value };
    case "email":
      return /.+@.+\..+/.test(value) ? { ok: true, value: value.toLowerCase() } : { ok: false, reason: `"${value}" is not an email` };
    case "textList":
    case "enumMulti": {
      const list = splitList(value);
      return { ok: true, value: "maxItems" in spec && spec.maxItems ? list.slice(0, spec.maxItems) : list };
    }
    case "enum": {
      if (!spec.values) return { ok: true, value };
      const match = spec.values.find((v) => v.toLowerCase() === value.toLowerCase());
      return match ? { ok: true, value: match } : { ok: false, reason: `"${value}" is not one of ${spec.values.join(", ")}` };
    }
    case "boolean": {
      const b = parseBoolean(value);
      return b === null ? { ok: false, reason: `"${value}" is not yes or no` } : { ok: true, value: b };
    }
    case "number":
    case "rating": {
      // « 6 », « 6,5 », « 6 years » ; jamais « ten » (qui donnerait 0).
      const cleaned = value.replace(",", ".").replace(/[^\d.-]/g, "");
      const n = Number(cleaned);
      return cleaned !== "" && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: `"${value}" is not a number` };
    }
    case "day": {
      const d = parseDay(value);
      return d ? { ok: true, value: d } : { ok: false, reason: `"${value}" is not a date` };
    }
    case "files": {
      // Pieces jointes Airtable : « photo.jpg (https://...) ». On garde la premiere URL.
      const url = value.match(/https?:\/\/[^\s),]+/)?.[0];
      return url ? { ok: true, value: url } : { ok: false, reason: "no URL found" };
    }
    case "founderRefs":
      return { ok: false, reason: "founder references are not imported" };
  }
}
