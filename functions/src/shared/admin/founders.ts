import { docPaths } from "../collections";
import { createWrite, mergeWrite, RuleError, setWrite, type DocWrite } from "../docWrites";
import { isSlackUserId, normalizeSlackId, SLACK_USER_ID_HINT } from "../slackLinks";
import type { Founder, FounderDirectory, FounderInternal, FounderProfile, Person, ProfileCategory } from "../types";

// ----------------------------
// Fiches de fondateur ecrites par le staff (Admin > Import founders, « Staff only » du profil)
// ----------------------------
// LA regle, partagee par l'ecran (lib/profile.ts, lib/slackAdmin.ts) et par l'API
// (`create_founders`, `set_founder_staff_fields`) : listes de `DocWrite`.

/** Le one-liner du track record (« Staff only » du profil) : une phrase, la grille l'affiche en entier, la liste sur une ligne. */
export const ONE_LINER_MAX = 140;

/**
 * L'id Slack d'une personne : l'original dans `people`, sa copie (PERSON_COPIES) dans le
 * `private/directory` de chacun de ses fondateurs (`founderIds`, un par batch) ; `null` (ou vide) l'efface.
 */
export function slackUserIdWrites(personId: string, founderIds: readonly string[], raw: string | null, now: string): DocWrite[] {
  const value = raw === null ? null : normalizeSlackId(raw);
  if (value !== null && !isSlackUserId(value)) throw new RuleError("invalid_slack_user_id", SLACK_USER_ID_HINT, "slackUserId");
  return [
    mergeWrite(docPaths.person(personId), { slackUserId: value, updatedDateISOString: now }),
    ...founderIds.map((id) => mergeWrite(docPaths.founderDirectory(id), { slackUserId: value })),
  ];
}

/** Un fondateur a creer dans un batch ; le reste de sa fiche se remplit ensuite (formulaires, `set_fields`, /claim). */
export type NewFounder = { firstName: string; lastName: string; email: string | null; profileCategory: ProfileCategory | null };

/** L'identite de la personne, dont la fiche porte les copies (PERSON_COPIES). */
type Identity = Pick<Person, "phone" | "whatsapp" | "linkedinUrl" | "photoUrl" | "slackUserId">;

/** Ce qu'un import apporte deja a la nouvelle fiche (colonnes du CSV), par document. */
export type NewFounderValues = {
  person?: Partial<Omit<Identity, "slackUserId">>;
  founder?: Partial<Pick<Founder, "profileCategory" | "hardSkills" | "industries" | "rolesICouldTake">>;
  founderDirectory?: Partial<FounderDirectory>;
  founderProfile?: Partial<FounderProfile>;
};

const emptyDirectory = (email: string): FounderDirectory => ({
  email,
  whatsapp: null,
  linkedinUrl: null,
  gender: null,
  nationality: null,
  country: null,
  introduceYourself: null,
  edge: null,
  education: [],
  degree: null,
  fieldOfStudy: null,
  yearsOfXP: null,
  notableCompanies: [],
  trackRecord: null,
  trackRecord3Liners: [],
  interestedInWorkingOn: null,
  hasExistingProject: null,
  projectExplanation: null,
  hasExistingCoFounders: null,
  openToJoinAnotherProject: null,
  mainStartup2025: null,
  lookingForCoFounder: null,
  coFounderTypeWanted: null,
  coFounderSkillsWanted: [],
  industriesToExplore: [],
});

const EMPTY_PROFILE: FounderProfile = { age: null, birthDayString: null, housingSupport: null, tShirtSize: null, enrolmentConfirmed: null };
const EMPTY_INTERNAL: FounderInternal = { background: null };

/**
 * Les documents d'un nouveau fondateur (`create_founders`, Admin > Import founders) : sa personne
 * (creee, ou celle d'un autre batch, dont l'identite fait foi : on ne la reecrit pas), la fiche et
 * ses trois documents prives, avec les copies de l'identite. Pas de rattachement de compte : il se
 * fera par email a la connexion, ou par /claim.
 */
export function newFounderWrites(
  scope: { programId: string; batchId: string },
  input: NewFounder,
  ids: { founderId: string; personId: string },
  existingPerson: Person | null,
  now: string,
  values: NewFounderValues = {},
): DocWrite[] {
  const email = existingPerson?.email || input.email || "";
  const displayName = existingPerson?.displayName || [input.firstName, input.lastName].filter(Boolean).join(" ");
  const identity: Identity = existingPerson ?? {
    phone: values.person?.phone ?? null,
    whatsapp: values.person?.whatsapp ?? null,
    linkedinUrl: values.person?.linkedinUrl ?? null,
    photoUrl: values.person?.photoUrl ?? null,
    slackUserId: null,
  };
  const personWrite = existingPerson
    ? mergeWrite(docPaths.person(ids.personId), { founderIds: [...new Set([...existingPerson.founderIds, ids.founderId])], updatedDateISOString: now })
    : createWrite(docPaths.person(ids.personId), {
        createdDateISOString: now,
        updatedDateISOString: now,
        archivedDateISOString: null,
        firstName: input.firstName,
        lastName: input.lastName,
        displayName,
        email,
        altEmails: [],
        ...identity,
        uid: null,
        founderIds: [ids.founderId],
        mentorId: null,
        investorId: null,
      } satisfies Person);
  const founder: Founder = {
    ...scope,
    createdDateISOString: now,
    updatedDateISOString: now,
    archivedDateISOString: null,
    personId: ids.personId,
    uid: null,
    claimedDateISOString: null,
    name: displayName,
    photoUrl: identity.photoUrl,
    profileCategory: values.founder?.profileCategory ?? input.profileCategory,
    hardSkills: values.founder?.hardSkills ?? [],
    industries: values.founder?.industries ?? [],
    rolesICouldTake: values.founder?.rolesICouldTake ?? [],
    trackRecordOneLiner: null,
    startupId: null,
    status: "enrolled",
    leftProgramReason: null,
    isExternalFounder: false,
    stats: null,
  };
  const { phone, whatsapp, linkedinUrl, slackUserId } = identity;
  return [
    personWrite,
    createWrite(docPaths.founder(ids.founderId), founder),
    setWrite(docPaths.founderDirectory(ids.founderId), { ...emptyDirectory(email), ...values.founderDirectory, email, phone, whatsapp, linkedinUrl, slackUserId }),
    setWrite(docPaths.founderProfile(ids.founderId), { ...EMPTY_PROFILE, ...values.founderProfile }),
    setWrite(docPaths.founderInternal(ids.founderId), EMPTY_INTERNAL),
  ];
}
