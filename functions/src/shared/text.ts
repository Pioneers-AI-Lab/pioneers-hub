// ----------------------------
// Texte saisi : recherche, adresses web, listes
// ----------------------------
// Logique pure, partagee par le front (recherche, formulaires) et le serveur
// (API, registre des champs, callables) : une seule regle des deux cotes.

/** Cle de recherche : minuscules, sans accents. « Chloé » se trouve en tapant « chloe ». */
export const searchKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Une cle stable tiree d'un libelle : « Calls made » -> `callsMade`, unique parmi `taken` (qu'elle complete). */
export function camelKey(label: string, taken: Set<string>): string {
  const words = searchKey(label).split(/[^a-z0-9]+/).filter(Boolean);
  const base = words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("") || "key";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}${n}`;
  taken.add(key);
  return key;
}

/** Une cle de famille (`submission.metrics.<cle>`, `evaluation.scores.<cle>`) tiree d'un libelle : `Calls made` -> `callsMade`, une lettre d'abord. */
export function keyFromLabel(label: string, taken: Set<string> = new Set()): string {
  const key = camelKey(label, taken);
  return /^[a-z]/.test(key) ? key : `m${key}`;
}

/**
 * Une adresse web complete (`https://` ajoute si besoin), ou `null` si ce
 * n'en est pas une : « linkedin.com/in/ada » se tape sans le protocole.
 */
export function normalizeHttpUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Un chemin de l'app (`/programs/…`), jamais une adresse d'un autre site (`//site`, `https://…`). */
export const isAppPath = (value: string): boolean => value.startsWith("/") && !value.startsWith("//");

/**
 * Separateurs d'une liste dont une entree peut contenir une virgule ou un tiret
 * (Education : « Grenoble INP - Phelma - Data Science, AI & Deep Learning » reste
 * une entree). Declares sur le champ par le registre (`separators` d'un `textList`).
 */
export const ENTRY_SEPARATORS: readonly string[] = [";", " · "];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Une liste saisie en un seul texte (Education : « HEC Paris; ESSEC » ou
 * « South Dakota State University · ESADE MBA ») -> une entree par element,
 * decoupee sur `separators` SEULEMENT (par defaut `ENTRY_SEPARATORS`). Espaces
 * retires, entrees vides et doublons exacts ecartes, ordre garde. Un tableau
 * (deja une liste) n'est pas redecoupe ; toute autre valeur donne `[]`. Lit
 * aussi une ancienne valeur texte, le temps de la migration
 * (scripts/migrate-education-tags.mjs).
 */
export function splitTextList(value: unknown, separators: readonly string[] = ENTRY_SEPARATORS): string[] {
  const pattern = separators.length ? new RegExp(separators.map(escapeRegExp).join("|")) : null;
  const parts =
    typeof value === "string"
      ? pattern
        ? value.split(pattern)
        : [value]
      : Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [];
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
}
