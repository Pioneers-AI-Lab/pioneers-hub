import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { newFounderWrites, ONE_LINER_MAX, slackUserIdWrites, type NewFounder } from "../../shared/admin/founders";
import { slackId } from "../schemas";
import { COL, docPaths } from "../../shared/collections";
import { mergeWrite, type DocWrite } from "../../shared/docWrites";
import { PHOTO_COVER_MAX, PHOTO_MIN_SIDE, PHOTO_THUMB_SIZE } from "../../shared/photos";
import { isSlackUserId, SLACK_USER_ID_HINT } from "../../shared/slackLinks";
import { nameKey } from "../../shared/text";
import { PROFILE_CATEGORIES, type Batch, type Founder, type Person, type WithId } from "../../shared/types";
import { badRequest } from "../../api/errors";
import type { Operation } from "../operations";
import { setFounderPhoto } from "../photos";
import { changesOf, effectPlan, mustRead, newDocId, readWhere, staffOnly, writePlan } from "./writes";

// ----------------------------
// services/admin - fiches de fondateur ecrites par le staff
// ----------------------------
// Admin > Import founders (`create_founders` : la creation ; le reste de la fiche passe
// par `set_fields`), « Staff only » du profil (`set_founder_staff_fields`), photo deposee
// par le staff (`set_founder_photo`, comme scripts/set-photo.mjs).

const FounderTarget = { founderId: z.string().min(1) };

export const CreateFoundersInput = z
  .object({
    batchId: z.string().min(1),
    founders: z
      .array(
        z
          .object({
            firstName: z.string().trim().min(1).max(80),
            lastName: z.string().trim().max(80).default(""),
            email: z.email().optional().describe("Their onboarding email: their account links itself to the profile at sign-in. Without it, they claim the profile (/claim)."),
            profileCategory: z.enum(PROFILE_CATEGORIES).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(60)
      .describe("New founders of the batch. Fill the rest of each profile afterwards with `pioneers_set_fields`."),
  })
  .strict();

/** Les personnes deja en base pour ces emails (requetes `in` de 30). */
async function peopleByEmail(tx: Transaction, emails: string[]): Promise<Map<string, WithId<Person>>> {
  const found = new Map<string, WithId<Person>>();
  for (let i = 0; i < emails.length; i += 30) {
    const snap = await tx.get(getFirestore().collection(COL.people).where("email", "in", emails.slice(i, i + 30)));
    for (const d of snap.docs) found.set(d.get("email") as string, { ...(d.data() as Person), id: d.id });
  }
  return found;
}

export const createFounders: Operation<typeof CreateFoundersInput> = {
  name: "create_founders",
  input: CreateFoundersInput,
  allowed: staffOnly,
  async plan(tx, _caller, { batchId, founders: given }) {
    const batch = await mustRead<Batch>(tx, docPaths.batch(batchId), "batch", "batchId");
    const drafts: NewFounder[] = given.map((f) => ({ firstName: f.firstName, lastName: f.lastName, email: f.email?.trim().toLowerCase() ?? null, profileCategory: f.profileCategory ?? null }));
    const emails = drafts.flatMap((d) => (d.email ? [d.email] : []));
    const twice = emails.find((e, i) => emails.indexOf(e) !== i);
    if (twice) throw badRequest("duplicate_email", `${twice} is given twice.`, "founders");
    const [inBatch, people] = await Promise.all([readWhere<Founder>(tx, COL.founders, "batchId", batchId), peopleByEmail(tx, emails)]);
    const namesInBatch = new Set(inBatch.filter((f) => !f.archivedDateISOString).map((f) => nameKey(f.name)));
    const personIdsInBatch = new Set(inBatch.map((f) => f.personId));
    const rows = drafts.map((input) => {
      const person = input.email ? (people.get(input.email) ?? null) : null;
      const name = person?.displayName || [input.firstName, input.lastName].filter(Boolean).join(" ");
      // Deja dans le batch (meme personne ou meme nom) : on complete sa fiche, on n'en cree pas une seconde.
      if ((person && personIdsInBatch.has(person.id)) || namesInBatch.has(nameKey(name))) {
        throw badRequest("already_in_batch", `${name} already has a profile in ${batch.name}: complete it with \`pioneers_set_fields\`.`, "founders");
      }
      namesInBatch.add(nameKey(name));
      return { input, name, person, founderId: newDocId(COL.founders), personId: person?.id ?? newDocId(COL.people) };
    });
    const now = new Date().toISOString();
    const scope = { programId: batch.programId, batchId };
    const writes = rows.flatMap((r) => newFounderWrites(scope, r.input, r, r.person, now));
    return writePlan(
      {
        batch: batch.name,
        founders: rows.map(({ name, input, person }) => ({ name, email: input.email, profile: person ? "new in this batch, same person as in another batch" : "new person" })),
        next: "Fill each profile with `pioneers_set_fields`.",
      },
      writes,
      { founderIds: rows.map((r) => r.founderId) },
    );
  },
};

export const SetFounderStaffFieldsInput = z
  .object({
    ...FounderTarget,
    trackRecordOneLiner: z.string().trim().max(ONE_LINER_MAX).nullable().optional().describe("The one-liner of their track record (founders grid card); null clears it."),
    slackUserId: slackId(isSlackUserId, SLACK_USER_ID_HINT).describe("Their Slack member ID (U0123ABCD), for direct messages; null clears it."),
  })
  .strict();

export const setFounderStaffFields: Operation<typeof SetFounderStaffFieldsInput> = {
  name: "set_founder_staff_fields",
  input: SetFounderStaffFieldsInput,
  allowed: staffOnly,
  async plan(tx, _caller, { founderId, trackRecordOneLiner, slackUserId }) {
    if (trackRecordOneLiner === undefined && slackUserId === undefined) throw badRequest("nothing_to_change", "Give `trackRecordOneLiner` and/or `slackUserId`.", "founderId");
    const founder = await mustRead<Founder>(tx, docPaths.founder(founderId), "founder", "founderId");
    const person = await mustRead<Person>(tx, docPaths.person(founder.personId), "person", "founderId");
    const now = new Date().toISOString();
    const oneLiner = trackRecordOneLiner === undefined ? undefined : trackRecordOneLiner || null;
    const writes: DocWrite[] = [
      ...(oneLiner !== undefined ? [mergeWrite(docPaths.founder(founderId), { trackRecordOneLiner: oneLiner, updatedDateISOString: now })] : []),
      // Sur chaque fiche de la personne (un fondateur par batch), comme les autres copies de `people`.
      ...(slackUserId !== undefined ? slackUserIdWrites(person.id, person.founderIds, slackUserId, now) : []),
    ];
    const changes = changesOf({ trackRecordOneLiner: founder.trackRecordOneLiner, slackUserId: person.slackUserId }, { trackRecordOneLiner: oneLiner, slackUserId });
    return writePlan({ founder: founder.name, changes }, writes, { founderId }, Object.keys(changes).length > 0);
  },
};

export const SetFounderPhotoInput = z
  .object({
    ...FounderTarget,
    imageUrl: z
      .url({ protocol: /^https?$/ })
      .nullable()
      .describe(`A direct link to the image (JPEG, PNG, WebP; ${PHOTO_MIN_SIDE} px or more on its short side). null removes the photo.`),
  })
  .strict();

export const setFounderPhotoAction: Operation<typeof SetFounderPhotoInput> = {
  name: "set_founder_photo",
  input: SetFounderPhotoInput,
  allowed: staffOnly,
  async plan(tx, _caller, { founderId, imageUrl }) {
    const founder = await mustRead<Founder>(tx, docPaths.founder(founderId), "founder", "founderId");
    const has = Boolean(founder.photoUrl || founder.coverPhotoUrl);
    return effectPlan(
      {
        founder: founder.name,
        current: has ? "a photo" : "no photo",
        does: imageUrl
          ? `downloads the image, checks it (${PHOTO_MIN_SIDE} px minimum), stores the large photo (${PHOTO_COVER_MAX} px) and the ${PHOTO_THUMB_SIZE} px thumbnail, as when the founder uploads it from their profile`
          : "removes the photo (thumbnail and large photo)",
      },
      [docPaths.founder(founderId), docPaths.person(founder.personId)],
      () => setFounderPhoto(founder, imageUrl),
      Boolean(imageUrl) || has,
      false,
    );
  },
};
