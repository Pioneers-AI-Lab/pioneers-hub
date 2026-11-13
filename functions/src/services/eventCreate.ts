import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { COL, docPaths } from "../shared/collections";
import { isStaffViewer } from "../shared/access";
import { eventFormDocs, eventFormsPlan } from "../shared/eventForms";
import { newEvent } from "../shared/events";
import { EVENT_TEMPLATES, type EventTemplateKey } from "../shared/presets/eventTemplates";
import { EVENT_KINDS, type Batch, type EventGuest, type Mentor, type Person, type PioneersEvent, type Startup } from "../shared/types";
import { badRequest, notFound } from "../api/errors";
import type { Operation } from "./operations";
import { isoDateTime } from "./schemas";

// ----------------------------
// services - CREER un evenement
// ----------------------------
// SPECS §4.8 : « Cree l'office hour de jeudi 15h avec ce mentor pour cette
// startup ». Le document se construit par `newEvent` (shared/events.ts), LA
// facon unique de construire un evenement (Admin > Events, l'import). Un modele
// est un PACK (SPECS §2) : l'evenement, son matching et ses formulaires, crees
// ensemble (shared/eventForms.ts) ; publies avec un evenement « scheduled », en
// brouillon avec un brouillon. Sans modele : un evenement seul.
//
// Staff seulement (regle `events` : write staff). Un evenement cree en
// brouillon (`draft`) n'est pas montre aux fondateurs ; `scheduled` l'est.

const TEMPLATE_KEYS = Object.keys(EVENT_TEMPLATES) as [EventTemplateKey, ...EventTemplateKey[]];

export const CreateEventInput = z
  .object({
    batchId: z.string().min(1),
    templateKey: z
      .enum(TEMPLATE_KEYS)
      .optional()
      .describe("Event model, a pack: the event (label, duration), its matching (teams or tables) and its forms (debrief, jury, picks, feedback), created together. Omit for a blank event."),
    kind: z.enum(EVENT_KINDS).optional().describe("Label of a blank event (an office hour is a `meeting`). Default `session`."),
    name: z.string().trim().min(1).max(120),
    startDateISOString: isoDateTime,
    endDateISOString: isoDateTime.optional(),
    location: z.string().trim().min(1).max(200).optional(),
    topic: z.string().trim().min(1).max(300).optional(),
    status: z.enum(["draft", "scheduled"]).optional().describe("Default `scheduled` (shown to founders). `draft` while the time is not fixed."),
    startupIds: z.array(z.string().min(1)).max(30).optional().describe("Startups concerned (office hour, pitch session): their members see the event."),
    mentorIds: z.array(z.string().min(1)).max(10).optional().describe("Mentors invited (office hour, session)."),
  })
  .strict();

export const createEvent: Operation<typeof CreateEventInput, { eventId: string }> = {
  name: "create_event",
  input: CreateEventInput,
  allowed: (caller) => isStaffViewer(caller.viewer),
  async plan(tx, _caller, input) {
    const db = getFirestore();
    const template = input.templateKey ? EVENT_TEMPLATES[input.templateKey] : null;
    if (template && input.kind && input.kind !== template.kind) {
      throw badRequest("invalid_kind", `The model \`${input.templateKey}\` is a \`${template.kind}\` event.`, "kind");
    }
    const start = input.startDateISOString;
    const end = input.endDateISOString ?? null;
    if (end && end <= start) throw badRequest("invalid_dates", "The event must end after it starts.", "endDateISOString");

    const startupIds = [...new Set(input.startupIds ?? [])];
    const mentorIds = [...new Set(input.mentorIds ?? [])];
    const [batchSnap, ...rest] = await tx.getAll(
      db.doc(docPaths.batch(input.batchId)),
      ...startupIds.map((id) => db.doc(docPaths.startup(id))),
      ...mentorIds.map((id) => db.doc(docPaths.mentor(id))),
    );
    const batch = batchSnap.data() as Batch | undefined;
    if (!batch) throw notFound("batch_not_found", `Batch \`${input.batchId}\` does not exist.`, "batchId");
    const startupSnaps = rest.splice(0, startupIds.length);
    const startups = startupSnaps.map((s) => s.data() as Startup | undefined);
    const foreign = startupIds.filter((_id, i) => startups[i]?.batchId !== input.batchId);
    if (foreign.length) throw notFound("startup_not_found", `Not startups of this batch: ${foreign.join(", ")}.`, "startupIds");
    const mentors = rest.map((m) => m.data() as Mentor | undefined);
    const missingMentors = mentorIds.filter((_id, i) => !mentors[i]);
    if (missingMentors.length) throw notFound("mentor_not_found", `Unknown mentors: ${missingMentors.join(", ")}.`, "mentorIds");

    // Le nom affiche d'un mentor est celui de sa personne (Mentor n'a pas de nom).
    const mentorPeople = mentors.length ? await tx.getAll(...mentors.map((m) => db.doc(docPaths.person(m!.personId)))) : [];
    const guests: EventGuest[] = mentors.map((m, i) => ({
      name: (mentorPeople[i]?.data() as Person | undefined)?.displayName ?? mentorIds[i],
      role: "mentor",
      personId: m!.personId,
      founderId: null,
      mentorId: mentorIds[i],
      intro: null,
    }));

    const data = newEvent(
      {
        programId: batch.programId,
        batchId: input.batchId,
        templateKey: input.templateKey ?? null,
        kind: input.kind,
        name: input.name,
        startDateISOString: start,
        status: input.status ?? "scheduled",
        location: input.location ?? null,
        // Sans fin : la duree du modele (une heure a blanc).
        endDateISOString: end,
      },
      { guests, startupIds, topic: input.topic ?? null },
    );

    // L'id se tire sans lecture : l'apercu et l'ecriture partagent le meme plan de formulaires.
    const ref = db.collection(COL.events).doc();
    const now = new Date().toISOString();
    const plans = eventFormsPlan(ref.id, data, {}, now);
    return {
      preview: {
        event: {
          name: data.name,
          batch: batch.name,
          kind: data.kind,
          model: template?.label ?? null,
          startDateISOString: data.startDateISOString,
          endDateISOString: data.endDateISOString,
          location: data.location,
          topic: data.topic,
          status: data.status,
          startups: startups.map((s) => s!.name),
          mentors: guests.map((g) => g.name),
          // Le pack : son matching et ses formulaires (grille du jury, metriques du Debrief).
          matching: data.matching ? `${data.matching.mode === "challenge" ? "teams" : "tables"} of ${data.matching.size.max}` : null,
          forms: plans.map((p) => `${p.form.title} (${p.form.status})`),
          scoringCriteria: template?.criteria.map((c) => c.label) ?? [],
          metrics: template?.metrics.map((m) => m.label) ?? [],
        },
      },
      targetPaths: [COL.events, COL.forms],
      commit: (wtx) => {
        wtx.create(ref, { ...data, createdDateISOString: now, updatedDateISOString: now } satisfies PioneersEvent);
        for (const plan of plans) for (const d of eventFormDocs(plan, now)) wtx.create(db.doc(d.path), d.data);
        return { eventId: ref.id };
      },
    };
  },
};
