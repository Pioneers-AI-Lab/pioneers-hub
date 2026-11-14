// ----------------------------
// Texte saisi : recherche et adresses web
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
