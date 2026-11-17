import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { BACKGROUND_CRITERIA, BACKGROUND_MAX_NOTE, backgroundRatingWrite, type BackgroundScores } from "../../shared/background";
import { COL, docPaths } from "../../shared/collections";
import { parisToday } from "../../shared/dates";
import { mergeWrite, RuleError } from "../../shared/docWrites";
import { normalizeDraft, startupCreationWrites, STARTUP_MAX_MEMBERS } from "../../shared/teamLocks";
import { founderReviewWrite, STARTUP_REVIEW_CRITERIA, startupReviewWrite, WEEKLY_REVIEW_MAX_NOTE } from "../../shared/weeklyReviews";
import type { Batch, Founder, PioneersEvent, Startup } from "../../shared/types";
import type { Operation } from "../operations";
import { dayString } from "../schemas";
import { mustRead, readWhere, staffOnly, writePlan } from "./writes";

// ----------------------------
// services/admin - revues des Weekly updates, Background, startups, presence optionnelle
// ----------------------------
// Admin > Reviews, Admin > Background, Admin > Startups et Admin > Events >
// Attendance : les gestes de shared/weeklyReviews.ts, shared/background.ts et
// shared/teamLocks.ts, comme a l'ecran (memes refus : RuleError -> 400).

const week = dayString.describe("The week's Monday, YYYY-MM-DD.");
const note = (max: number) => z.number().int().min(0).max(max);

export const ReviewFounderInput = z
  .object({
    founderId: z.string().min(1),
    weekStartDayString: week,
    goalAmbitious: z.boolean().nullable().optional().describe("Was last week's goal ambitious enough?"),
    goalReached: z.boolean().nullable().optional().describe("Was last week's goal reached?"),
    problemValidated: z.boolean().nullable().optional(),
    comment: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const reviewFounder: Operation<typeof ReviewFounderInput> = {
  name: "review_founder_update",
  input: ReviewFounderInput,
  allowed: staffOnly,
  async plan(tx, caller, input) {
    const founder = await mustRead<Founder>(tx, docPaths.founder(input.founderId), "founder", "founderId");
    const review = {
      programId: founder.programId,
      batchId: founder.batchId,
      founderId: founder.id,
      weekStartDayString: input.weekStartDayString,
      goalAmbitious: input.goalAmbitious ?? null,
      goalReached: input.goalReached ?? null,
      problemValidated: input.problemValidated ?? null,
      comment: input.comment ?? null,
    };
    return writePlan({ founder: founder.name, review }, [founderReviewWrite(review, caller.uid, new Date().toISOString())], { founderId: founder.id });
  },
};

export const ReviewStartupInput = z
  .object({
    startupId: z.string().min(1),
    weekStartDayString: week,
    scores: z
      .object(Object.fromEntries(STARTUP_REVIEW_CRITERIA.map((c) => [c.key, note(WEEKLY_REVIEW_MAX_NOTE).nullable().optional().describe(`${c.label} (${c.points} points): ${c.definition}`)])))
      .strict(),
    outstanding: z.boolean().optional().describe("Only with every criterion at the maximum."),
    comment: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const reviewStartup: Operation<typeof ReviewStartupInput> = {
  name: "review_startup_update",
  input: ReviewStartupInput,
  allowed: staffOnly,
  async plan(tx, caller, input) {
    const startup = await mustRead<Startup>(tx, docPaths.startup(input.startupId), "startup", "startupId");
    const review = {
      programId: startup.programId,
      batchId: startup.batchId,
      startupId: startup.id,
      weekStartDayString: input.weekStartDayString,
      scores: input.scores as Record<string, number | null>,
      outstanding: input.outstanding ?? false,
      comment: input.comment ?? null,
    };
    return writePlan({ startup: startup.name, review }, [startupReviewWrite(review, caller.uid, new Date().toISOString())], { startupId: startup.id });
  },
};

export const RateBackgroundInput = z
  .object({
    founderId: z.string().min(1),
    scores: z
      .object(Object.fromEntries(BACKGROUND_CRITERIA.map((c) => [c.key, note(BACKGROUND_MAX_NOTE).describe(`${c.label} (${c.points} points)${c.definition ? `: ${c.definition}` : ""}`)])))
      .strict(),
    outstanding: z.boolean().optional().describe("Only with every criterion at the maximum."),
  })
  .strict();

export const rateBackground: Operation<typeof RateBackgroundInput> = {
  name: "rate_background",
  input: RateBackgroundInput,
  allowed: staffOnly,
  async plan(tx, caller, { founderId, scores, outstanding }) {
    const founder = await mustRead<Founder>(tx, docPaths.founder(founderId), "founder", "founderId");
    return writePlan(
      { founder: founder.name, scores, outstanding: outstanding ?? false, note: "Claude's proposal, if any, stays next to the staff rating." },
      [backgroundRatingWrite(founderId, { scores: scores as BackgroundScores, outstanding: outstanding ?? false }, caller.uid, new Date().toISOString())],
      { founderId },
    );
  },
};

export const CreateStartupsInput = z
  .object({
    batchId: z.string().min(1),
    startups: z
      .array(z.object({ name: z.string().trim().min(1).max(80), memberIds: z.array(z.string().min(1)).min(1).max(STARTUP_MAX_MEMBERS) }).strict())
      .min(1)
      .max(30)
      .describe("Confirmed teams (Lock my team, Admin > Startups): each founder of the batch, without a startup yet."),
  })
  .strict();

export const createStartups: Operation<typeof CreateStartupsInput> = {
  name: "create_startups",
  input: CreateStartupsInput,
  allowed: staffOnly,
  async plan(tx, _caller, { batchId, startups: drafts }) {
    const batch = await mustRead<Batch>(tx, docPaths.batch(batchId), "batch", "batchId");
    const memberIds = [...new Set(drafts.flatMap((d) => normalizeDraft(d).memberIds))];
    const db = getFirestore();
    const [members, existing] = await Promise.all([
      tx.getAll(...memberIds.map((id) => db.doc(docPaths.founder(id)))),
      readWhere<Startup>(tx, COL.startups, "batchId", batchId),
    ]);
    const founders = members.flatMap((s) => (s.exists ? [{ ...(s.data() as Founder), id: s.id }] : []));
    const { writes, startupIds } = startupCreationWrites({
      programId: batch.programId,
      batchId,
      drafts,
      founders,
      existingStartupIds: new Set(existing.map((s) => s.id)),
      dayString: parisToday(),
      nowISO: new Date().toISOString(),
    });
    // Un id deja pris par une startup d'un AUTRE batch : `create` le refuse a l'ecriture ; on le dit avant.
    const taken = (await tx.getAll(...startupIds.map((id) => db.doc(docPaths.startup(id))))).find((s) => s.exists);
    if (taken) throw new RuleError("already_exists", `A startup already exists as \`${taken.id}\`: rename this one.`, "startups");
    const nameOf = new Map(founders.map((f) => [f.id, f.name]));
    return writePlan(
      { batch: batch.name, startups: drafts.map((d, i) => ({ id: startupIds[i], name: d.name, members: d.memberIds.map((id) => nameOf.get(id) ?? id) })) },
      writes,
      { startupIds },
    );
  },
};

export const SetAttendanceOptionalInput = z
  .object({ eventId: z.string().min(1), optional: z.boolean().describe("true: attendance is still taken, but neither it nor the event's forms count in Engagement.") })
  .strict();

export const setAttendanceOptional: Operation<typeof SetAttendanceOptionalInput> = {
  name: "set_attendance_optional",
  input: SetAttendanceOptionalInput,
  allowed: staffOnly,
  async plan(tx, _caller, { eventId, optional }) {
    const event = await mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId");
    return writePlan(
      { event: event.name, attendanceOptional: optional },
      [mergeWrite(docPaths.event(eventId), { attendanceOptional: optional, updatedDateISOString: new Date().toISOString() })],
      { eventId },
      (event.attendanceOptional === true) !== optional,
    );
  },
};
