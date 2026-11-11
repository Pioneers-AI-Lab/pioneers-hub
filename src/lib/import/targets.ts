import { DB_FIELDS, parseDbField, type DbFieldKey, type ValueSpec } from "@shared/fieldRegistry";

// ----------------------------
// Import CSV : vers quels champs une colonne peut aller
// ----------------------------
// Les cibles sont celles du REGISTRE DES CHAMPS (shared/fieldRegistry.ts) pour
// les documents d'un fondateur, plus deux colonnes speciales : le nom complet
// (decoupe en prenom / nom) et l'email (cle du dedoublonnage et du
// rattachement de compte). Un champ absent du registre ne s'importe pas.

const IMPORT_DOCS = new Set(["person", "founder", "founderDirectory", "founderProfile"]);

export type ImportFieldKey = DbFieldKey;
export type ImportTarget = "fullName" | "email" | ImportFieldKey;

export const IMPORT_FIELD_KEYS = (Object.keys(DB_FIELDS) as DbFieldKey[]).filter((key) =>
  IMPORT_DOCS.has(parseDbField(key).doc),
);

const DOC_GROUP: Record<string, string> = {
  person: "Identity",
  founder: "Founder card",
  founderDirectory: "Profile book",
  founderProfile: "Private",
};

export function targetLabel(target: ImportTarget): string {
  if (target === "fullName") return "Full name";
  if (target === "email") return "Email";
  return DB_FIELDS[target].label;
}

export function targetSpec(target: ImportFieldKey): ValueSpec {
  return DB_FIELDS[target].value;
}

/** Options du menu de correspondance, groupees par document. */
export function targetOptions() {
  const groups = new Map<string, { value: string; label: string }[]>();
  groups.set("Required", [
    { value: "email", label: "Email" },
    { value: "fullName", label: "Full name" },
  ]);
  for (const key of IMPORT_FIELD_KEYS) {
    const group = DOC_GROUP[parseDbField(key).doc];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ value: key, label: DB_FIELDS[key].label });
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

// ---- Reconnaissance automatique des colonnes -----------------------------------
// Noms de colonnes de l'Airtable Spring 2026 (SPECS annexe B) et questions du
// formulaire d'onboarding (docs/repos/repos-A.md), compares sans casse ni
// ponctuation. Le staff corrige ce qui n'est pas reconnu.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const ALIASES: Record<string, ImportTarget> = {
  fullname: "fullName",
  name: "fullName",
  nom: "fullName",
  email: "email",
  emailaddress: "email",
  adresseemail: "email",
  firstname: "person.firstName",
  prenom: "person.firstName",
  lastname: "person.lastName",
  phone: "person.phone",
  whatsapp: "person.whatsapp",
  linkedin: "person.linkedinUrl",
  linkedinurl: "person.linkedinUrl",
  yourphoto: "person.photoUrl",
  photo: "person.photoUrl",
  profilecategory: "founder.profileCategory",
  hardskills: "founder.hardSkills",
  whathardskillsareyouproficientat: "founder.hardSkills",
  industries: "founder.industries",
  whatindustriesdoyouhavemostexperiencein: "founder.industries",
  rolesicouldtake: "founder.rolesICouldTake",
  whatrolescouldyoutakeasacofounder: "founder.rolesICouldTake",
  positionfit: "founder.rolesICouldTake",
  introduceyourself: "founderDirectory.introduceYourself",
  introduction: "founderDirectory.introduceYourself",
  gender: "founderDirectory.gender",
  nationality: "founderDirectory.nationality",
  country: "founderDirectory.country",
  maineducation: "founderDirectory.education",
  whatschoolsdidyougraduatefrom: "founderDirectory.education",
  educationschool: "founderDirectory.education",
  degree: "founderDirectory.degree",
  whatisyourbestdegree: "founderDirectory.degree",
  educationdegree: "founderDirectory.degree",
  fieldofstudy: "founderDirectory.fieldOfStudy",
  whatfieldsofstudy: "founderDirectory.fieldOfStudy",
  educationfield: "founderDirectory.fieldOfStudy",
  yearsofxp: "founderDirectory.yearsOfXP",
  notablecompaniesworkedat: "founderDirectory.notableCompanies",
  whatarenotablecompaniesyouworkedat: "founderDirectory.notableCompanies",
  trackrecord: "founderDirectory.trackRecord",
  trackrecordwhatareyoumostproudof: "founderDirectory.trackRecord",
  whatiaminterestedinworkingon: "founderDirectory.interestedInWorkingOn",
  whatareyouinterestedworkingon: "founderDirectory.interestedInWorkingOn",
  doyouhaveanexistingprojectidea: "founderDirectory.hasExistingProject",
  ifyesexplainitinafewwords: "founderDirectory.projectExplanation",
  doyouhaveexistingcofoundersinthebatch: "founderDirectory.hasExistingCoFounders",
  areyouopentojoinanotherprojectduringtheprogram: "founderDirectory.openToJoinAnotherProject",
  birthdate: "founderProfile.birthDayString",
  age: "founderProfile.age",
  tshirtsize: "founderProfile.tShirtSize",
};

export function guessTarget(header: string): ImportTarget | null {
  const key = norm(header);
  if (!key) return null;
  if (ALIASES[key]) return ALIASES[key];
  if (key.startsWith("doyouconfirmyourenrol") || key.startsWith("iconfirmmyenrol")) return "founderProfile.enrolmentConfirmed";
  // Libelle exact d'un champ du registre (« Hard skills », « Years of experience »...).
  const byLabel = IMPORT_FIELD_KEYS.find((k) => norm(DB_FIELDS[k].label) === key);
  return byLabel ?? null;
}
