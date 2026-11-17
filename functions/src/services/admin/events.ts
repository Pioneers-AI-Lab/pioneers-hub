import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import {
  eventArchiveWrites,
  eventSettingsWrites,
  eventTemplatePlan,
  eventTemplateWrites,
  isEventMoved,
  lockedSettingKeys,
  type EventSettings,
} from "../../shared/admin/events";
import { COL, docPaths, eventCollectionPaths } from "../../shared/collections";
import { isArchivedAs } from "../../shared/docWrites";
import { planEventMove } from "../../shared/eventForms";
import { founderGuest, guestCopiesOf, mentorGuest } from "../../shared/events";
import { EVENT_TEMPLATES, type EventTemplateKey } from "../../shared/presets/eventTemplates";
import type { EventGuest, Founder, Form, Mentor, Person, PioneersEvent } from "../../shared/types";
import { badRequest, notFound } from "../../api/errors";
import type { Operation } from "../operations";
import { isoDateTime } from "../schemas";
import { changesOf, mustRead, readWhere, staffOnly, writePlan } from "./writes";

// ----------------------------
// services/admin - un evenement : regler, deplacer, archiver, lui appliquer un modele
// ----------------------------
// Les gestes d'Admin > Events > un evenement, calcules par shared/admin/events.ts
// comme a l'ecran. Un evenement relie a l'agenda Google garde ses champs
// d'agenda (`CALENDAR_FIELDS`) : ils se changent dans Google, et l'API le dit
// au lieu de les ignorer.

const TEMPLATE_KEYS = Object.keys(EVENT_TEMPLATES) as [EventTemplateKey, ...EventTemplateKey[]];
const ids = z.array(z.string().min(1)).max(60);
const url = z.url().max(2000).nullable();

export const UpdateEventInput = z
  .object({
    eventId: z.string().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    topic: z.string().trim().max(2000).nullable().optional().describe("The description shown to founders."),
    startDateISOString: isoDateTime.optional(),
    endDateISOString: isoDateTime.nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    videoCallUrl: url.optional(),
    signUpUrl: url.optional(),
    resourceUrl: url.optional(),
    isMilestone: z.boolean().optional(),
    status: z.enum(["draft", "scheduled", "live", "locked", "completed"]).optional().describe("`draft` hides it from founders."),
    audience: z.enum(["batch", "guests"]).optional().describe("`guests`: only invited founders, startups' members and mentors see it (office hours)."),
    startupIds: ids.optional().describe("Startups concerned (replaces the list)."),
    guestFounderIds: ids.optional().describe("Invited founders (replaces them; other guests stay)."),
    mentorIds: ids.optional().describe("Invited mentors (replaces them; other guests stay)."),
    moveForms: z.boolean().optional().describe("New time: also move its forms' dates and the attached Debrief slot. Default true."),
  })
  .strict();

/**
 * Les invites apres le changement : les fondateurs et mentors donnes (un invite
 * deja la garde son intro), les autres (speakers, jures...) restent.
 */
async function guestsAfter(
  tx: FirebaseFirestore.Transaction,
  event: PioneersEvent,
  founderIds: string[] | undefined,
  mentorIds: string[] | undefined,
): Promise<EventGuest[] | null> {
  if (!founderIds && !mentorIds) return null;
  const db = getFirestore();
  const guests = event.guests ?? [];
  const [founders, mentors] = splitAt(
    await getAllOf(tx, [...(founderIds ?? []).map((id) => docPaths.founder(id)), ...(mentorIds ?? []).map((id) => docPaths.mentor(id))]),
    founderIds?.length ?? 0,
  );
  const missing = [...founders, ...mentors].filter((s) => !s.exists).map((s) => s.id);
  if (missing.length) throw notFound("guest_not_found", `Unknown founders or mentors: ${missing.join(", ")}.`, "guestFounderIds");
  const foreign = founders.filter((s) => (s.data() as Founder).batchId !== event.batchId).map((s) => s.id);
  if (foreign.length) throw notFound("founder_not_found", `Not founders of this batch: ${foreign.join(", ")}.`, "guestFounderIds");
  const people = mentors.length ? await tx.getAll(...mentors.map((m) => db.doc(docPaths.person((m.data() as Mentor).personId)))) : [];
  const introOf = (pick: (g: EventGuest) => boolean) => guests.find(pick)?.intro ?? null;
  return [
    ...guests.filter((g) => !(founderIds && g.founderId) && !(mentorIds && g.mentorId)),
    ...founders.map((s) => founderGuest(s.id, s.data() as Founder, introOf((g) => g.founderId === s.id))),
    ...mentors.map((s, i) =>
      mentorGuest(s.id, (s.data() as Mentor).personId, (people[i]?.data() as Person | undefined)?.displayName, introOf((g) => g.mentorId === s.id)),
    ),
  ];
}

const getAllOf = (tx: FirebaseFirestore.Transaction, paths: string[]) =>
  paths.length ? tx.getAll(...paths.map((p) => getFirestore().doc(p))) : Promise.resolve([]);
const splitAt = <T,>(list: T[], n: number): [T[], T[]] => [list.slice(0, n), list.slice(n)];

export const updateEvent: Operation<typeof UpdateEventInput> = {
  name: "update_event",
  input: UpdateEventInput,
  allowed: staffOnly,
  async plan(tx, _caller, input) {
    const { eventId, moveForms, guestFounderIds, mentorIds, ...given } = input;
    const event = await mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId");
    const locked = lockedSettingKeys(event, given);
    if (locked.length) {
      throw badRequest("calendar_field", `This event comes from Google Calendar: change ${locked.map((k) => `\`${k}\``).join(", ")} in the calendar (the Hub follows within a minute).`, locked[0]);
    }
    const next = {
      startDateISOString: given.startDateISOString ?? event.startDateISOString,
      endDateISOString: given.endDateISOString !== undefined ? given.endDateISOString : event.endDateISOString,
    };
    if (next.endDateISOString && next.endDateISOString <= next.startDateISOString) {
      throw badRequest("invalid_dates", "The event must end after it starts.", "endDateISOString");
    }
    // Un nouvel horaire deplace ses formulaires et le Debrief accole (planEventMove), comme a l'ecran.
    const isMoved = moveForms !== false && isEventMoved(event, next);
    const now = new Date().toISOString();
    const [guests, events, forms] = await Promise.all([
      guestsAfter(tx, event, guestFounderIds, mentorIds),
      isMoved ? readWhere<PioneersEvent>(tx, COL.events, "batchId", event.batchId) : [],
      isMoved ? readWhere<Form>(tx, COL.forms, "batchId", event.batchId) : [],
    ]);
    const move = isMoved ? planEventMove({ event, next, events: events.filter((e) => e.archivedDateISOString === null), forms, moveLinked: true, nowISO: now }) : null;
    const settings: Partial<EventSettings> = { ...given, ...(guests ? { guests, ...guestCopiesOf(guests) } : {}) };

    // Les copies des invites (`guestFounderIds`, `mentorIds`) suivent `guests` : l'apercu montre les noms.
    const changes = changesOf(event, { ...given, ...(guests ? { guests } : {}) });
    if (changes.guests) changes.guests = { from: (event.guests ?? []).map((g) => g.name), to: (guests ?? []).map((g) => g.name) };
    const hasMoves = Boolean(move?.moves.length || move?.linked?.isMoved);
    return writePlan(
      {
        event: event.name,
        changes,
        movedForms: move?.moves.map((m) => ({ form: m.form.title, opensDateISOString: m.opensDateISOString, deadlineDateISOString: m.deadlineDateISOString })) ?? [],
        keptForms: move?.kept.map((k) => ({ form: k.form.title, reason: k.reason })) ?? [],
        movedEvent: move?.linked?.isMoved ? { event: move.linked.event.name, ...move.linked.to } : null,
      },
      eventSettingsWrites(event, settings, move, now),
      { eventId },
      Object.keys(changes).length > 0 || hasMoves,
    );
  },
};

export const ArchiveEventInput = z
  .object({ eventId: z.string().min(1), archived: z.boolean().describe("true: hide it everywhere and close its open forms. false: restore it.") })
  .strict();

export const archiveEvent: Operation<typeof ArchiveEventInput> = {
  name: "archive_event",
  input: ArchiveEventInput,
  allowed: staffOnly,
  async plan(tx, _caller, { eventId, archived }) {
    const [event, forms] = await Promise.all([mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId"), readWhere<Form>(tx, COL.forms, "eventId", eventId)]);
    const { writes, touchedForms } = eventArchiveWrites(event, archived, forms, new Date().toISOString());
    return writePlan(
      { event: event.name, archived, [archived ? "closedForms" : "reopenedForms"]: touchedForms.map((f) => f.title) },
      writes,
      { eventId },
      !isArchivedAs(event, archived),
    );
  },
};

export const ApplyEventTemplateInput = z
  .object({
    eventId: z.string().min(1),
    templateKey: z.enum(TEMPLATE_KEYS).describe("The model (a pack): its label, its matching if the event has none, and the forms it does not have yet."),
  })
  .strict();

export const applyEventTemplate: Operation<typeof ApplyEventTemplateInput> = {
  name: "apply_event_template",
  input: ApplyEventTemplateInput,
  allowed: staffOnly,
  async plan(tx, _caller, { eventId, templateKey }) {
    const [event, forms, teams] = await Promise.all([
      mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId"),
      readWhere<Form>(tx, COL.forms, "eventId", eventId),
      tx.get(getFirestore().collection(eventCollectionPaths.teams(eventId)).limit(1)),
    ]);
    const now = new Date().toISOString();
    const plan = eventTemplatePlan(event, templateKey, forms, !teams.empty, now);
    return writePlan(
      {
        event: event.name,
        model: EVENT_TEMPLATES[templateKey].label,
        changes: changesOf(event, plan.patch),
        newForms: plan.forms.map((p) => `${p.form.title} (${p.form.status})`),
      },
      eventTemplateWrites(eventId, plan, now),
      { eventId },
    );
  },
};
