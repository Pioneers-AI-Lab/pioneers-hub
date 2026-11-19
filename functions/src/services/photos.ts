import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { docPaths } from "../shared/collections";
import { newPhotoPath, PHOTO_COVER_MAX, PHOTO_MIN_SIDE, PHOTO_THUMB_SIZE, uploadedPhotoPath } from "../shared/photos";
import type { Founder, WithId } from "../shared/types";
import { badRequest } from "../api/errors";

// ----------------------------
// services - la photo d'un fondateur deposee par le staff (`set_founder_photo`)
// ----------------------------
// Ce que fait « Mon profil » (src/lib/profile.ts saveProfilePhoto) et scripts/set-photo.mjs, aux
// memes tailles (shared/photos.ts) : la grande photo dans Storage, son URL a jeton dans
// `founders.coverPhotoUrl`, la vignette en data URL dans `photoUrl` (`people` et la fiche). Le
// fichier precedent depose par l'app est supprime. Sans image : la photo est retiree.

const MAX_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

async function download(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null);
  if (!response?.ok) throw badRequest("image_unreachable", `The image could not be downloaded (${response ? `HTTP ${response.status}` : "no answer"}). Give a direct, public link to the image.`, "imageUrl");
  if (!response.headers.get("content-type")?.startsWith("image/")) throw badRequest("not_an_image", "This link is not an image (a web page?). Give a direct link to the image file.", "imageUrl");
  const tooLarge = () => badRequest("image_too_large", "The image is over 15 MB.", "imageUrl");
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw tooLarge();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw tooLarge();
  return bytes;
}

const downloadUrl = (bucket: string, path: string, token: string) => {
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  return `${host ? `http://${host}` : "https://firebasestorage.googleapis.com"}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
};

/** La grande photo et la vignette, tiree de la grande (un seul decodage de l'original, qui peut peser des dizaines de Mo). */
async function renditions(original: Buffer) {
  // Module natif : charge par la seule action qui s'en sert, pas a chaque demarrage de l'API.
  const { default: sharp } = await import("sharp");
  const { width = 0, height = 0 } = await sharp(original)
    .metadata()
    .catch(() => ({ width: 0, height: 0 }));
  if (Math.min(width, height) < PHOTO_MIN_SIDE) throw badRequest("image_too_small", `The image is ${width} x ${height} px: ${PHOTO_MIN_SIDE} px minimum on its short side.`, "imageUrl");
  const cover = await sharp(original).rotate().resize(PHOTO_COVER_MAX, PHOTO_COVER_MAX, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const thumb = await sharp(cover).resize(PHOTO_THUMB_SIZE, PHOTO_THUMB_SIZE, { fit: "cover", position: "attention" }).jpeg({ quality: 80 }).toBuffer();
  return { cover, thumb };
}

async function upload(founderId: string, imageUrl: string) {
  const { cover, thumb } = await renditions(await download(imageUrl));
  const bucket = getStorage().bucket();
  const path = newPhotoPath(founderId);
  const token = randomUUID();
  await bucket.file(path).save(cover, { contentType: "image/jpeg", metadata: { cacheControl: "public, max-age=31536000", metadata: { firebaseStorageDownloadTokens: token } } });
  return { photoUrl: `data:image/jpeg;base64,${thumb.toString("base64")}`, coverPhotoUrl: downloadUrl(bucket.name, path, token) };
}

export async function setFounderPhoto(founder: WithId<Founder>, imageUrl: string | null): Promise<{ founderId: string; coverPhotoUrl: string | null }> {
  const previous = uploadedPhotoPath(founder.coverPhotoUrl, founder.id);
  const { photoUrl, coverPhotoUrl } = imageUrl ? await upload(founder.id, imageUrl) : { photoUrl: null, coverPhotoUrl: null };
  const db = getFirestore();
  // La vignette est une copie de `people` (PERSON_COPIES) : sur chaque fiche de la personne ; la grande photo, sur celle-ci.
  const founderIds = ((await db.doc(docPaths.person(founder.personId)).get()).get("founderIds") as string[] | undefined) ?? [founder.id];
  const batch = db.batch();
  batch.set(db.doc(docPaths.person(founder.personId)), { photoUrl, updatedDateISOString: new Date().toISOString() }, { merge: true });
  for (const id of founderIds) batch.set(db.doc(docPaths.founder(id)), id === founder.id ? { photoUrl, coverPhotoUrl } : { photoUrl }, { merge: true });
  await batch.commit();
  if (previous) await getStorage().bucket().file(previous).delete({ ignoreNotFound: true });
  return { founderId: founder.id, coverPhotoUrl };
}
