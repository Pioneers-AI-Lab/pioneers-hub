import { getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { COL, docPaths, eventCollectionPaths } from "../shared/collections";
import { LIST_KEYS, type Batch, type ClosedList, type Founder, type Note, type PioneersEvent, type Program, type Startup } from "../shared/types";
import {
  canReadFounderCard,
  canReadFounderDirectory,
  canReadFounderProfile,
  canReadPerson,
  canReadStartupProfile,
  canReadTeam,
  isInsider,
  isInsiderViewer,
} from "../shared/access";
import type { Caller } from "../api/caller";
import { badRequest, forbidden, notFound } from "../api/errors";
import { founderIdIn, roleOf } from "../api/viewer";
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
// ⛔️ CHAQUE OBJET EST FILTRE PAR LES DROITS DE L'APPELANT, ici et nulle part
// ailleurs : l'Admin SDK ignore firestore.rules, donc ce fichier en est le
// miroir (shared/access.ts, les memes fonctions que le front). Un objet que le
// role ne lit pas est INTROUVABLE (404, pas 403 : on ne revele pas qu'il
// existe) ; un sous-document prive est simplement absent.

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

/** Le type d'objet de chaque URL REST (`/v1/founders/{id}` -> `founder`) : le routeur ET la spec OpenAPI le lisent. */
export const REST_OBJECTS = {
  programs: "program",
  batches: "batch",
  founders: "founder",
  startups: "startup",
  events: "event",
  notes: "note",
} as const satisfies Record<string, (typeof GET_OBJECTS)[number]>;

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
    investorAccess: caller.viewer.investorAccess ?? undefined,
    /** Le profil fondateur du compte dans chaque batch (sa fiche : `get founder`). */
    founderProfiles: [...caller.foundersByBatch].map(([batchId, founderId]) => ({ batchId, founderId })),
    programs: programs.docs.map((p) => ({
      id: p.id,
      name: p.get("name"),
      batches: batches.docs
        .filter((b) => b.get("programId") === p.id)
        .map((b) => ({ id: b.id, name: b.get("name"), status: b.get("status"), startDayString: b.get("startDayString") })),
    })),
  };
}

export async function listObjects(caller: Caller, input: ListInput): Promise<{ object: string; items: unknown[] }> {
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
    // Notes internes : staff et investors IC (regle `notes`), quel que soit le batch.
    if (!isInsiderViewer(caller.viewer)) throw forbidden("not_visible", "Internal notes are visible to staff and IC investors only.");
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
  // Fondateurs : la carte n'est lue que par le batch, le staff, les investors,
  // ou si elle est publique ou non reclamee (regle `founders`).
  const role = object === "founders" ? roleOf(caller, input.batchId!) : null;
  const visible = role ? docs.filter((d) => canReadFounderCard(role, d as unknown as Founder)) : docs;
  if (spec.sort) visible.sort((a, b) => String(a[spec.sort!] ?? "").localeCompare(String(b[spec.sort!] ?? "")));
  return { object, items: visible.map((d) => (spec.short as (x: unknown) => unknown)(d)) };
}

function required(snap: DocumentSnapshot, object: string, id: string) {
  if (!snap.exists) throw notFound(`${object}_not_found`, `No ${object} with id \`${id}\`.`, "id");
  return snap;
}

/** Un sous-document lu seulement si le role le voit : sinon ni lu, ni rendu. */
async function readIf(ok: boolean, path: string) {
  return ok ? dataOf(await getFirestore().doc(path).get()) : undefined;
}

export async function getObject(caller: Caller, input: GetInput): Promise<Record<string, unknown>> {
  const db = getFirestore();
  const { object, id } = input;
  const hidden = () => notFound(`${object}_not_found`, `No ${object} with id \`${id}\`.`, "id");

  switch (object) {
    case "program":
    case "batch":
      return { object, ...withId(required(await db.doc(`${SIMPLE_GETS[object]}/${id}`).get(), object, id)) };

    case "note": {
      if (!isInsiderViewer(caller.viewer)) throw hidden();
      return { object, ...withId(required(await db.doc(`${SIMPLE_GETS.note}/${id}`).get(), object, id)) };
    }

    case "founder": {
      const founderSnap = required(await db.doc(docPaths.founder(id)).get(), object, id);
      const founder = founderSnap.data() as Founder;
      const role = roleOf(caller, founder.batchId);
      if (!canReadFounderCard(role, founder)) throw hidden();
      const insider = isInsider(role);
      // La personne : lue pour l'insider ou si c'est le compte lui-meme (`founder.uid` est son rattachement).
      const [person, directory, profile, internal, stats] = await Promise.all([
        readIf(insider || founder.uid === caller.uid, docPaths.person(founder.personId)),
        readIf(canReadFounderDirectory(role), docPaths.founderDirectory(id)),
        readIf(canReadFounderProfile(role, founderIdIn(caller, founder.batchId), id), docPaths.founderProfile(id)),
        readIf(insider, docPaths.founderInternal(id)),
        readIf(insider, `${COL.founderStats}/${id}`),
      ]);
      const personVisible = person && canReadPerson(role, caller.uid, person as { uid: string | null });
      return { object, ...withId(founderSnap), person: personVisible ? person : undefined, directory, profile, internal, stats };
    }

    case "startup": {
      // L'appartenance a l'equipe se decide sur la startup (`memberIds`) : elle se lit d'abord.
      const startupSnap = required(await db.doc(docPaths.startup(id)).get(), object, id);
      const startup = startupSnap.data() as Startup;
      const role = roleOf(caller, startup.batchId);
      const insideTeam = canReadStartupProfile(role, founderIdIn(caller, startup.batchId), startup);
      const [profile, internal, checkins] = await Promise.all([
        readIf(insideTeam, docPaths.startupProfile(id)),
        readIf(isInsider(role), docPaths.startupInternal(id)),
        insideTeam ? db.collection(COL.checkins).where("startupId", "==", id).get() : null,
      ]);
      const recentCheckins = checkins?.docs
        .map((d) => withId<{ weekStartDayString: string }>(d))
        .sort((a, b) => b.weekStartDayString.localeCompare(a.weekStartDayString))
        .slice(0, 8);
      return { object, ...withId(startupSnap), profile, internal, recentCheckins };
    }

    case "event": {
      const insider = isInsiderViewer(caller.viewer);
      const [event, teams, attendance, submissions] = await Promise.all([
        db.doc(docPaths.event(id)).get(),
        db.collection(eventCollectionPaths.teams(id)).get(),
        insider ? db.collection(eventCollectionPaths.attendance(id)).get() : null,
        db.collection(eventCollectionPaths.submissions(id)).get(),
      ]);
      const role = roleOf(caller, (required(event, object, id).data() as PioneersEvent).batchId);
      return {
        object,
        ...withId(event),
        teams: teams.docs.map((d) => withId<{ publishedDateISOString: string | null }>(d)).filter((t) => canReadTeam(role, t)),
        attendance: attendance?.docs.map((d) => ({ founderId: d.id, status: d.get("status") })),
        submissions: submissions.docs.map((d) => withId(d)),
      };
    }
  }
}
