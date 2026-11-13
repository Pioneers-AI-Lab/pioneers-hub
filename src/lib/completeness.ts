import { FOUNDER_SELF_EDITABLE } from "@shared/access";
import { getFieldDef, listMissingFields, parseDbField, type DbFieldKey } from "@shared/fieldRegistry";
import type { Founder, FounderDirectory, FounderProfile } from "@shared/types";

// ----------------------------
// Ce qui manque au profil d'un fondateur, et qu'il peut remplir lui-meme
// ----------------------------
// `listMissingFields` (registre des champs) dit ce qui est attendu ; on ne
// garde que ce que « Mon profil » sait ecrire (FOUNDER_SELF_EDITABLE). WhatsApp
// et LinkedIn sont attendus sur `people` : on lit leurs copies.

const EDITABLE = new Set<string>([
  ...FOUNDER_SELF_EDITABLE.founder.map((f) => `founder.${f}`),
  ...FOUNDER_SELF_EDITABLE.founderDirectory.map((f) => `founderDirectory.${f}`),
  ...FOUNDER_SELF_EDITABLE.founderProfile.map((f) => `founderProfile.${f}`),
  // Deposee depuis « Mon profil » (FOUNDER_PHOTO_FIELDS), hors FOUNDER_SELF_EDITABLE.
  "founder.coverPhotoUrl",
  "person.whatsapp",
  "person.linkedinUrl",
]);

export type MissingProfileField = { key: DbFieldKey; label: string; required: boolean };

export function missingProfileFields(
  founder: Founder,
  directory: FounderDirectory | null,
  profile: FounderProfile | null,
): MissingProfileField[] {
  const missing = listMissingFields({
    owner: "founder",
    docs: {
      founder,
      founderDirectory: directory,
      founderProfile: profile,
      person: { whatsapp: directory?.whatsapp ?? null, linkedinUrl: directory?.linkedinUrl ?? null },
    },
    weeks: [],
    events: [],
  });
  return missing
    .filter((m) => EDITABLE.has(m.dbField) && parseDbField(m.dbField).doc !== "founderWeek")
    .map((m) => ({ key: m.dbField, label: getFieldDef(m.dbField).label, required: m.priority === "required" }))
    .sort((a, b) => Number(b.required) - Number(a.required));
}

/**
 * Champs obligatoires vides : un profil est complet quand il n'y en a aucun.
 * La grille de l'annuaire passe `profile = null` (document prive) : aucun champ
 * obligatoire modifiable par le fondateur n'y vit. En ajouter un la fausserait.
 */
export const missingRequiredFields = (founder: Founder, directory: FounderDirectory | null, profile: FounderProfile | null) =>
  missingProfileFields(founder, directory, profile).filter((m) => m.required);
