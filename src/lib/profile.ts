import { writeBatch } from "firebase/firestore";
import { FOUNDER_SELF_EDITABLE } from "@shared/access";
import type { Founder, FounderDirectory, FounderProfile, WithId } from "@shared/types";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { PreparedPhoto } from "@/lib/photo";
import { refs } from "@/lib/firestore/refs";

// ----------------------------
// « Mon profil » : ecriture par le fondateur lui-meme
// ----------------------------
// Les champs autorises sont ceux de FOUNDER_SELF_EDITABLE (shared/access.ts),
// miroir des regles. WhatsApp et LinkedIn s'ecrivent dans `people` (l'original)
// ET dans `private/directory` (la copie lue par le batch), dans le meme lot.

type Pick<T, K extends readonly (keyof T)[]> = { [P in K[number]]?: T[P] };

export type MyProfilePatch = {
  founder: Pick<Founder, typeof FOUNDER_SELF_EDITABLE.founder>;
  directory: Pick<FounderDirectory, typeof FOUNDER_SELF_EDITABLE.founderDirectory>;
  profile: Pick<FounderProfile, typeof FOUNDER_SELF_EDITABLE.founderProfile>;
};

/** `canWriteIdentity` : la personne est rattachee a ce compte (sinon WhatsApp et LinkedIn sont refuses). */
export async function saveMyProfile(founder: WithId<Founder>, patch: MyProfilePatch, canWriteIdentity: boolean) {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  if (Object.keys(patch.founder).length > 0) {
    batch.set(refs.founder(founder.id), { ...patch.founder, updatedDateISOString: now }, { merge: true });
  }
  const { whatsapp, linkedinUrl, phone, ...directory } = patch.directory;
  const identity = {
    ...(whatsapp !== undefined ? { whatsapp } : {}),
    ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
    ...(phone !== undefined ? { phone } : {}),
  };
  const directoryPatch = canWriteIdentity ? { ...directory, ...identity } : directory;
  if (Object.keys(directoryPatch).length > 0) {
    batch.set(refs.founderDirectory(founder.id), directoryPatch, { merge: true });
  }
  if (canWriteIdentity && Object.keys(identity).length > 0) {
    batch.set(refs.person(founder.personId), { ...identity, updatedDateISOString: now }, { merge: true });
  }
  if (Object.keys(patch.profile).length > 0) {
    batch.set(refs.founderProfile(founder.id), patch.profile, { merge: true });
  }
  await batch.commit();
}

/** Le chemin Storage d'une photo deposee depuis « Mon profil » (`founders/{id}/photo-*.jpg`), d'apres son URL. */
function uploadedPhotoPath(url: string | null | undefined, founderId: string): string | null {
  const encoded = url?.match(/\/o\/([^?]+)/)?.[1];
  const path = encoded ? decodeURIComponent(encoded) : null;
  return path && new RegExp(`^founders/${founderId}/photo-[A-Za-z0-9_-]+\\.jpg$`).test(path) ? path : null;
}

/** Les erreurs Storage et Firestore d'une photo, en clair (affichees par `useAction`). */
function photoError(err: unknown): Error {
  const code = (err as { code?: string }).code;
  if (code === "storage/retry-limit-exceeded") return new Error("The photo could not be sent: storage is unreachable. Check your connection and try again.");
  if (code === "storage/unauthorized" || code === "permission-denied") return new Error("You are not allowed to change this photo.");
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Ecrit la photo d'un fondateur, ou la retire (`null`) : la vignette dans
 * `people` (l'original) et sur la fiche (copie), avec la grande photo, en un lot
 * (regles : `copyMatches`, `isThumbnail`, `isFounderPhotoUrl`). Seule la fiche de
 * CE batch recoit la copie : les regles refusent celle d'un autre batch, ou le
 * compte n'est pas membre. La photo deposee qu'elle remplace est ensuite
 * supprimee de Storage sans l'attendre (au mieux) : son URL ne sert plus. Celle
 * de l'import (`cover.jpg`) reste, ecrite hors regles.
 * La fiche ne change pas de `updatedDateISOString` : le formulaire ouvert
 * (cle sur cette date) garde ce qui est en cours de saisie.
 */
async function commitPhoto(founder: WithId<Founder>, thumbnail: string | null, coverPhotoUrl: string | null) {
  const previous = uploadedPhotoPath(founder.coverPhotoUrl, founder.id);
  const batch = writeBatch(db);
  batch.set(refs.person(founder.personId), { photoUrl: thumbnail, updatedDateISOString: new Date().toISOString() }, { merge: true });
  batch.set(refs.founder(founder.id), { photoUrl: thumbnail, coverPhotoUrl }, { merge: true });
  await batch.commit();
  if (previous) void deleteObject(storageRef(storage, previous)).catch(() => undefined);
}

/**
 * Nouvelle photo (« Mon profil », fondateur ou staff) : la grande photo dans
 * Storage (`founders/{id}/photo-<horodatage>.jpg`, une URL par version), puis
 * `commitPhoto`.
 */
export async function saveProfilePhoto(founder: WithId<Founder>, photo: PreparedPhoto) {
  try {
    const file = storageRef(storage, `founders/${founder.id}/photo-${Date.now().toString(36)}.jpg`);
    await uploadBytes(file, photo.cover, { contentType: "image/jpeg", cacheControl: "public, max-age=31536000" });
    await commitPhoto(founder, photo.thumbnail, await getDownloadURL(file));
  } catch (err) {
    throw photoError(err);
  }
}

/** Retire la photo (vignette et grande photo) : le profil redevient incomplet (« HD photo »). */
export async function removeProfilePhoto(founder: WithId<Founder>) {
  try {
    await commitPhoto(founder, null, null);
  } catch (err) {
    throw photoError(err);
  }
}
