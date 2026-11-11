import { writeBatch } from "firebase/firestore";
import { FOUNDER_SELF_EDITABLE } from "@shared/access";
import type { Founder, FounderDirectory, FounderProfile, WithId } from "@shared/types";
import { db } from "@/lib/firebase";
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
  const { whatsapp, linkedinUrl, ...directory } = patch.directory;
  const identity = {
    ...(whatsapp !== undefined ? { whatsapp } : {}),
    ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
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
