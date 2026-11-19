import { getDoc, writeBatch } from "firebase/firestore";
import { FOUNDER_SELF_EDITABLE } from "@shared/access";
import { newPhotoPath, uploadedPhotoPath } from "@shared/photos";
import { normalizeHttpUrl } from "@shared/text";
import type { Founder, FounderDirectory, FounderProfile, WithId } from "@shared/types";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { PreparedPhoto } from "@/lib/photo";
import { refs } from "@/lib/firestore/refs";
import { slackUserIdWrites } from "@shared/admin/founders";
import { addWrites } from "@/lib/firestore/write";

// ----------------------------
// « Mon profil » : ecriture par le fondateur lui-meme
// ----------------------------
// Les champs autorises sont ceux de FOUNDER_SELF_EDITABLE (shared/access.ts),
// miroir des regles. WhatsApp et LinkedIn s'ecrivent dans `people` (l'original)
// ET dans `private/directory` (la copie lue par le batch), dans le meme lot.
// LinkedIn s'enregistre en adresse complete (`https://` ajoute) : l'API et les
// exports lisent la base, pas l'affichage.

type Pick<T, K extends readonly (keyof T)[]> = { [P in K[number]]?: T[P] };

export type MyProfilePatch = {
  founder: Pick<Founder, typeof FOUNDER_SELF_EDITABLE.founder>;
  /** Avec la date du To do quand cet enregistrement complete le profil (`completesProfile`). */
  directory: Pick<FounderDirectory, [...typeof FOUNDER_SELF_EDITABLE.founderDirectory, "profileCompletedDateISOString"]>;
  profile: Pick<FounderProfile, typeof FOUNDER_SELF_EDITABLE.founderProfile>;
};

/**
 * Champs que le staff seul modifie (section « Staff only ») ; absent = inchange.
 * `slackUserId` : `people` et ses copies (`slackUserIdWrites`, la regle de l'API). `trackRecordOneLiner` :
 * la fiche (regle `founders` : ecriture staff, hors FOUNDER_SELF_EDITABLE).
 */
export type StaffPatch = { slackUserId?: string | null; trackRecordOneLiner?: string | null };

/**
 * Les fiches qui portent les copies de `people` (PERSON_COPIES, une fiche par batch de la personne),
 * comme l'API (services/fields.ts) : toutes pour le staff ; pour le fondateur, celles rattachees a son
 * compte (les regles refusent les autres). Celle-ci d'abord.
 */
async function copyHolders(founder: WithId<Founder>, asStaff: boolean): Promise<string[]> {
  const others = ((await getDoc(refs.person(founder.personId))).data()?.founderIds ?? []).filter((id) => id !== founder.id);
  if (asStaff || others.length === 0) return [founder.id, ...others];
  const docs = await Promise.all(others.map((id) => getDoc(refs.founder(id))));
  return [founder.id, ...docs.filter((d) => founder.uid !== null && d.data()?.uid === founder.uid).map((d) => d.id)];
}

/**
 * `canWriteIdentity` : la personne est rattachee a ce compte (sinon WhatsApp et LinkedIn sont refuses).
 * `asStaff` : le staff edite (copies de l'identite sur toutes les fiches de la personne).
 */
export async function saveMyProfile(founder: WithId<Founder>, patch: MyProfilePatch, canWriteIdentity: boolean, staff: StaffPatch = {}, asStaff = false) {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const { slackUserId, trackRecordOneLiner } = staff;
  const founderPatch = { ...patch.founder, ...(trackRecordOneLiner !== undefined ? { trackRecordOneLiner } : {}) };
  if (Object.keys(founderPatch).length > 0) {
    batch.set(refs.founder(founder.id), { ...founderPatch, updatedDateISOString: now }, { merge: true });
  }
  const { whatsapp, linkedinUrl, phone, ...directory } = patch.directory;
  const identity = {
    ...(whatsapp !== undefined ? { whatsapp } : {}),
    ...(linkedinUrl !== undefined ? { linkedinUrl: linkedinUrl && (normalizeHttpUrl(linkedinUrl) ?? linkedinUrl) } : {}),
    ...(phone !== undefined ? { phone } : {}),
  };
  const hasIdentity = canWriteIdentity && Object.keys(identity).length > 0;
  const holders = hasIdentity || slackUserId !== undefined ? await copyHolders(founder, asStaff) : [];
  if (Object.keys(directory).length > 0) {
    batch.set(refs.founderDirectory(founder.id), directory, { merge: true });
  }
  if (hasIdentity) {
    batch.set(refs.person(founder.personId), { ...identity, updatedDateISOString: now }, { merge: true });
    for (const id of holders) batch.set(refs.founderDirectory(id), identity, { merge: true });
  }
  if (Object.keys(patch.profile).length > 0) {
    batch.set(refs.founderProfile(founder.id), patch.profile, { merge: true });
  }
  if (slackUserId !== undefined) addWrites(batch, slackUserIdWrites(founder.personId, holders, slackUserId, now));
  await batch.commit();
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
async function commitPhoto(founder: WithId<Founder>, thumbnail: string | null, coverPhotoUrl: string | null, asStaff: boolean, completes = false) {
  const previous = uploadedPhotoPath(founder.coverPhotoUrl, founder.id);
  const now = new Date().toISOString();
  const holders = await copyHolders(founder, asStaff);
  const batch = writeBatch(db);
  batch.set(refs.person(founder.personId), { photoUrl: thumbnail, updatedDateISOString: now }, { merge: true });
  // La vignette est une copie de `people` (chaque fiche de la personne) ; la grande photo, celle-ci seulement.
  for (const id of holders) batch.set(refs.founder(id), id === founder.id ? { photoUrl: thumbnail, coverPhotoUrl } : { photoUrl: thumbnail }, { merge: true });
  // La photo, dernier champ obligatoire : la date de « Complete your profile » au To do.
  if (completes) batch.set(refs.founderDirectory(founder.id), { profileCompletedDateISOString: now }, { merge: true });
  await batch.commit();
  if (previous) void deleteObject(storageRef(storage, previous)).catch(() => undefined);
}

/**
 * Nouvelle photo (« Mon profil », fondateur ou staff) : la grande photo dans
 * Storage (`founders/{id}/photo-<horodatage>.jpg`, une URL par version), puis
 * `commitPhoto` ; `completes` : la photo etait le dernier champ obligatoire (date du To do).
 */
export async function saveProfilePhoto(founder: WithId<Founder>, photo: PreparedPhoto, asStaff: boolean, completes = false) {
  try {
    const file = storageRef(storage, newPhotoPath(founder.id));
    await uploadBytes(file, photo.cover, { contentType: "image/jpeg", cacheControl: "public, max-age=31536000" });
    await commitPhoto(founder, photo.thumbnail, await getDownloadURL(file), asStaff, completes);
  } catch (err) {
    throw photoError(err);
  }
}

/** Retire la photo (vignette et grande photo) : le profil redevient incomplet (« HD photo »). */
export async function removeProfilePhoto(founder: WithId<Founder>, asStaff: boolean) {
  try {
    await commitPhoto(founder, null, null, asStaff);
  } catch (err) {
    throw photoError(err);
  }
}
