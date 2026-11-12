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
