import { getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { COL, docPaths, eventCollectionPaths } from "../shared/collections";
import { LIST_KEYS, type Batch, type ClosedList, type Founder, type Note, type PioneersEvent, type Program, type Startup } from "../shared/types";
import type { Caller } from "../api/caller";
import { badRequest, notFound } from "../api/errors";
import { describeFields } from "./fields";

// ----------------------------
// services - LIRE
// ----------------------------
// On lit GENERIQUEMENT (un `list` et un `get` parametres par type d'objet), on
// ecrit NOMMEMENT (lecon de Trippple : un modele ne doit pas pouvoir se tromper
// d'objet quand il ecrit, et chaque type de lecture en plus couterait un outil).
//
// `list` rend une forme COURTE de chaque objet, de quoi en choisir un ; `get`
// rend l'objet entier, sous-documents prives fusionnes.
//
// ⛔️ JAMAIS LUS ICI : `events/*/peerRatings` (SPECS §4.8 : Claude n'a acces
// qu'aux agregats des avis entre pairs, `founderStats.peerRating`), `picks`
// (mutual picks individuels), `events/*/judges` (empreintes des jetons des
// jures), `apiKeys`, `writePlans`. Aucun chemin de ce fichier ne les nomme ;
// les sous-collections d'evenement lues sont celles de `eventCollectionPaths`.
//
// v1 : appelants staff uniquement (api/caller.ts). Ouvrir aux investors =
// filtrer chaque objet par shared/access.ts AVANT de l'ouvrir ici.

type Doc<T> = T & { id: string };

/** Les listes simples : une collection, un filtre d'egalite, un tri, une forme courte. */
const SIMPLE_LISTS = {
  programs: { col: COL.programs, by: null, sort: null, short: (p: Doc<Program>) => ({ id: p.id, name: p.name }) },
  batches: {
    col: COL.batches,
    by: "programId",
    sort: null,
    short: (b: Doc<Batch>) => ({ id: b.id, name: b.name, status: b.status, startDayString: b.startDayString, endDayString: b.endDayString }),
  },
  founders: {
    col: COL.founders,
    by: "batchId",
    sort: "name",
    short: (f: Doc<Founder>) => ({
      id: f.id,
      name: f.name,
      status: f.status,
      profileCategory: f.profileCategory,
      startupId: f.startupId,
      personId: f.personId,
      claimed: f.uid !== null,
    }),
  },
  startups: {
    col: COL.startups,
    by: "batchId",
    sort: "name",
    short: (s: Doc<Startup>) => ({ id: s.id, name: s.name, ideaOneLine: s.ideaOneLine, status: s.status, memberIds: s.memberIds }),
  },
  events: {
    col: COL.events,
    by: "batchId",
    sort: "startDateISOString",
    short: (e: Doc<PioneersEvent>) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      stage: e.stage,
      status: e.status,
      startDateISOString: e.startDateISOString,
      startupIds: e.startupIds,
    }),
  },
} as const;

const LIST_OBJECTS = [...(Object.keys(SIMPLE_LISTS) as (keyof typeof SIMPLE_LISTS)[]), "notes", "fields", "lists"] as const;

/** Les objets qu'on lit seuls, sans sous-document. */
const SIMPLE_GETS = { program: COL.programs, batch: COL.batches, note: COL.notes } as const;
export const GET_OBJECTS = [...(Object.keys(SIMPLE_GETS) as (keyof typeof SIMPLE_GETS)[]), "founder", "startup", "event"] as const;

export const ListInput = z
  .object({
    object: z.enum(LIST_OBJECTS),
    programId: z.string().min(1).optional().describe("batches: the program."),
    batchId: z.string().min(1).optional().describe("Required for founders, startups, events."),
    founderId: z.string().min(1).optional().describe("notes: notes about this founder (or their startup)."),
    startupId: z.string().min(1).optional().describe("notes: notes about this startup."),
    search: z.string().trim().min(1).optional().describe("Keep objects whose name contains this (accents and case ignored)."),
    includeArchived: z.boolean().optional(),
  })
  .strict();
export type ListInput = z.output<typeof ListInput>;

export const GetInput = z.object({ object: z.enum(GET_OBJECTS), id: z.string().min(1) }).strict();
export type GetInput = z.output<typeof GetInput>;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const withId = <T = Record<string, unknown>>(snap: DocumentSnapshot) => ({ id: snap.id, ...snap.data() }) as Doc<T>;

const dataOf = (snap: DocumentSnapshot) => (snap.exists ? (snap.data() ?? null) : null);

/** Le compte connecte et ses programmes et batchs, avec leurs ids : le point de depart d'un agent. */
export async function whoami(caller: Caller) {
  const db = getFirestore();
  const live = (col: string) => db.collection(col).where("archivedDateISOString", "==", null).get();
  const [programs, batches] = await Promise.all([live(COL.programs), live(COL.batches)]);
  return {
    uid: caller.uid,
    roles: caller.viewer.roles,
    programs: programs.docs.map((p) => ({
      id: p.id,
      name: p.get("name"),
      batches: batches.docs
        .filter((b) => b.get("programId") === p.id)
        .map((b) => ({ id: b.id, name: b.get("name"), status: b.get("status"), startDayString: b.get("startDayString") })),
    })),
  };
}

export async function listObjects(input: ListInput): Promise<{ object: string; items: unknown[] }> {
  const db = getFirestore();
  const { object } = input;

  if (object === "fields") return { object, items: describeFields() };

  if (object === "lists") {
    const snaps = await db.getAll(...LIST_KEYS.map((k) => db.doc(`${COL.lists}/${k}`)));
    return {
      object,
      items: snaps
        .filter((s) => s.exists)
        .map((s) => {
          const d = s.data() as ClosedList;
          return { key: s.id, label: d.label, values: d.items.filter((i) => !i.archived).map((i) => i.value) };
        }),
    };
  }

  if (object === "notes") {
    if (!input.founderId && !input.startupId) {
      throw badRequest("missing_argument", "`founderId` or `startupId` is required to list `notes`.", "founderId");
    }
    const q = input.startupId
      ? db.collection(COL.notes).where("startupId", "==", input.startupId)
      : db.collection(COL.notes).where("founderIds", "array-contains", input.founderId);
    const notes = (await q.get()).docs.map((d) => withId<Note>(d)).filter((n) => input.includeArchived || !n.archivedDateISOString);
    return {
      object,
      items: notes
        .sort((a, b) => b.dayString.localeCompare(a.dayString))
        .map((n) => ({
          id: n.id,
          dayString: n.dayString,
          source: n.source,
          targetType: n.targetType,
          targetId: n.targetId,
          excerpt: n.body.length > 280 ? `${n.body.slice(0, 280)}...` : n.body,
        })),
    };
  }

  const spec = SIMPLE_LISTS[object];
  let query: FirebaseFirestore.Query = db.collection(spec.col);
  if (spec.by) {
    const value = input[spec.by];
    if (!value) throw badRequest("missing_argument", `\`${spec.by}\` is required to list \`${object}\`.`, spec.by);
    query = query.where(spec.by, "==", value);
  }
  const search = input.search ? fold(input.search) : null;
  const docs = (await query.get()).docs
    .map((d) => withId<{ name?: string; archivedDateISOString?: string | null } & Record<string, unknown>>(d))
    .filter((d) => input.includeArchived || !d.archivedDateISOString)
    .filter((d) => !search || fold(String(d.name ?? "")).includes(search));
  if (spec.sort) docs.sort((a, b) => String(a[spec.sort!] ?? "").localeCompare(String(b[spec.sort!] ?? "")));
  return { object, items: docs.map((d) => (spec.short as (x: unknown) => unknown)(d)) };
}

function required(snap: DocumentSnapshot, object: string, id: string) {
  if (!snap.exists) throw notFound(`${object}_not_found`, `No ${object} with id \`${id}\`.`, "id");
  return snap;
}

export async function getObject(input: GetInput): Promise<Record<string, unknown>> {
  const db = getFirestore();
  const { object, id } = input;

  switch (object) {
    case "program":
    case "batch":
    case "note":
      return { object, ...withId(required(await db.doc(`${SIMPLE_GETS[object]}/${id}`).get(), object, id)) };

    case "founder": {
      const founder = required(await db.doc(docPaths.founder(id)).get(), object, id);
      const [directory, profile, internal, stats, person] = await db.getAll(
        db.doc(docPaths.founderDirectory(id)),
        db.doc(docPaths.founderProfile(id)),
        db.doc(docPaths.founderInternal(id)),
        db.doc(`${COL.founderStats}/${id}`),
        db.doc(docPaths.person((founder.data() as Founder).personId)),
      );
      return {
        object,
        ...withId(founder),
        person: dataOf(person),
        directory: dataOf(directory),
        profile: dataOf(profile),
        internal: dataOf(internal),
        stats: dataOf(stats),
      };
    }

    case "startup": {
      const [[startup, profile, internal], checkins] = await Promise.all([
        db.getAll(db.doc(docPaths.startup(id)), db.doc(docPaths.startupProfile(id)), db.doc(docPaths.startupInternal(id))),
        db.collection(COL.checkins).where("startupId", "==", id).get(),
      ]);
      required(startup, object, id);
      const recentCheckins = checkins.docs
        .map((d) => withId<{ weekStartDayString: string }>(d))
        .sort((a, b) => b.weekStartDayString.localeCompare(a.weekStartDayString))
        .slice(0, 8);
      return { object, ...withId(startup), profile: dataOf(profile), internal: dataOf(internal), recentCheckins };
    }

    case "event": {
      const [event, teams, attendance, submissions] = await Promise.all([
        db.doc(docPaths.event(id)).get(),
        db.collection(eventCollectionPaths.teams(id)).get(),
        db.collection(eventCollectionPaths.attendance(id)).get(),
        db.collection(eventCollectionPaths.submissions(id)).get(),
      ]);
      return {
        object,
        ...withId(required(event, object, id)),
        teams: teams.docs.map((d) => withId(d)),
        attendance: attendance.docs.map((d) => ({ founderId: d.id, status: d.get("status") })),
        submissions: submissions.docs.map((d) => withId(d)),
      };
    }
  }
}
