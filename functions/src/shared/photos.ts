// ----------------------------
// Photo d'un fondateur : tailles et fichier, LA regle de l'ecran (src/lib/photo.ts, lib/profile.ts),
// de l'API (`set_founder_photo`, services/photos.ts) et de scripts/set-photo.mjs
// ----------------------------
// La grande photo : 800 px au plus sur son grand cote, JPEG, dans Storage ; la vignette des
// avatars : 128 x 128, JPEG en data URL (`photoUrl`). Une image trop petite est refusee.

export const PHOTO_COVER_MAX = 800;
export const PHOTO_THUMB_SIZE = 128;
/** Plus petit cote minimal d'une photo HD. */
export const PHOTO_MIN_SIDE = 400;

/** Le fichier d'une nouvelle grande photo : une URL par version. */
export const newPhotoPath = (founderId: string) => `founders/${founderId}/photo-${Date.now().toString(36)}.jpg`;

/** Le chemin Storage d'une photo deposee par l'app (`founders/{id}/photo-*.jpg`), d'apres son URL a jeton ; `null` sinon (import, autre site). */
export function uploadedPhotoPath(url: string | null | undefined, founderId: string): string | null {
  const encoded = url?.match(/\/o\/([^?]+)/)?.[1];
  const path = encoded ? decodeURIComponent(encoded) : null;
  return path && new RegExp(`^founders/${founderId}/photo-[A-Za-z0-9_-]+\\.jpg$`).test(path) ? path : null;
}
