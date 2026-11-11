import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { COL, docPaths } from "../shared/collections";
import type { Founder, Note, NoteSource, Startup } from "../shared/types";
import { notFound } from "../api/errors";
import type { Operation } from "./operations";
import { dayString, parisToday } from "./schemas";

// ----------------------------
// services - ajouter une NOTE interne
// ----------------------------
// SPECS §4.8 : « Ajoute ces notes de reunion a la fiche de cette startup ».
// Une note sur une startup est aussi rattachee a ses membres (`founderIds`),
// une note sur un fondateur a sa startup : la fiche de chacun retrouve tout.
// Lisible par le staff et les investors IC (firestore.rules `notes`).

const NOTE_SOURCES = ["office_hours", "mentor", "observation", "granola", "claude"] as const satisfies readonly NoteSource[];

export const AddNoteInput = z
  .object({
    targetType: z.enum(["founder", "startup"]),
    targetId: z.string().min(1),
    body: z.string().trim().min(1).max(20000),
    source: z.enum(NOTE_SOURCES).optional().describe("Where the note comes from. Default: `claude` via MCP, `observation` via the API."),
    dayString: dayString.optional().describe("Day the note is about, YYYY-MM-DD. Default: today (Paris)."),
    eventId: z.string().min(1).optional().describe("Office hour or session the note comes from."),
  })
  .strict();

export const addNote: Operation<typeof AddNoteInput, { noteId: string }> = {
  name: "add_note",
  input: AddNoteInput,
  async plan(tx, caller, input) {
    const db = getFirestore();
    const targetPath = input.targetType === "startup" ? docPaths.startup(input.targetId) : docPaths.founder(input.targetId);
    const [target, event] = await tx.getAll(db.doc(targetPath), ...(input.eventId ? [db.doc(docPaths.event(input.eventId))] : []));

    if (!target.exists) throw notFound(`${input.targetType}_not_found`, `No ${input.targetType} with id \`${input.targetId}\`.`, "targetId");
    if (event && !event.exists) throw notFound("event_not_found", `Event \`${input.eventId}\` does not exist.`, "eventId");

    const attached =
      input.targetType === "startup"
        ? (({ programId, batchId, memberIds, name }: Startup) => ({ programId, batchId, founderIds: memberIds, startupId: input.targetId, targetName: name }))(
            target.data() as Startup,
          )
        : (({ programId, batchId, startupId, name }: Founder) => ({ programId, batchId, founderIds: [input.targetId], startupId, targetName: name }))(
            target.data() as Founder,
          );
    const { targetName, ...links } = attached;

    const note: Omit<Note, "createdDateISOString" | "updatedDateISOString"> = {
      ...links,
      targetType: input.targetType,
      targetId: input.targetId,
      mentorId: null,
      eventId: input.eventId ?? null,
      authorUid: caller.uid,
      source: input.source ?? (caller.via === "mcp" ? "claude" : "observation"),
      dayString: input.dayString ?? parisToday(),
      body: input.body,
      archivedDateISOString: null,
    };

    return {
      preview: { note: { ...note, targetName } },
      targetPaths: [COL.notes],
      commit: (wtx) => {
        const ref = db.collection(COL.notes).doc();
        const now = new Date().toISOString();
        wtx.create(ref, { ...note, createdDateISOString: now, updatedDateISOString: now } satisfies Note);
        return { noteId: ref.id };
      },
    };
  },
};
