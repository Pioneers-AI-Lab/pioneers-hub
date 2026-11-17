import { getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { COL, docIds, docPaths, eventCollectionPaths } from "../shared/collections";
import { FOUNDER_REVIEWS_COLLECTION, STARTUP_REVIEWS_COLLECTION } from "../shared/weeklyReviews";
import { groupTeamLocks, TEAM_LOCKS_COLLECTION, teamLockPath } from "../shared/teamLocks";
import {
  LIST_KEYS,
  parseAnswerKey,
  readDirectory,
  readFounderInternal,
  type Batch,
  type BatchTask,
  type ClosedList,
  type Form,
  type FormResponse,
  type TeamLock,
  type Founder,
  type Mentor,
  type Note,
  type PioneersEvent,
  type Program,
  type Startup,
} from "../shared/types";
import {
  canReadFounderDirectory,
  canReadFounderProfile,
  canReadPerson,
  canReadStartupProfile,
  canReadTeam,
  canSeeEvent,
  isInsider,
  isInsiderViewer,
  isStaffOrInvestor,
  isStaffViewer,
} from "../shared/access";
import { isPublishedEvent } from "../shared/events";
import type { Caller } from "../api/caller";
import { badRequest, forbidden, notFound } from "../api/errors";
import { founderIdIn, roleOf } from "../api/viewer";
import { searchKey } from "../shared/text";
import { describeFields } from "./fields";
import { listAccounts } from "./accounts";
import { actionsFor } from "./actions";
import { formUrl } from "../api/config";

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
// (mutual picks individuels), `events/*/judges` (secret du lien partage
// du jury), `apiKeys`, `writePlans`, `founders/*/private/connections` (shortlist et
// rencontres : un outil du fondateur, lu a l'ecran seulement), `shortlistHistory`
// (shortlists une par une). Aucun chemin de ce fichier ne les nomme ; les
// sous-collections d'evenement lues sont celles de `eventCollectionPaths`.
// STAFF SEULEMENT : `teamLocks`, `founderReviews`, `startupReviews`, les notes du
// jury une par une (`evaluations`), `formResponses` (sans avis ni picks).
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

const LIST_OBJECTS = [
  ...(Object.keys(SIMPLE_LISTS) as (keyof typeof SIMPLE_LISTS)[]),
  "notes",
  "forms",
  "tasks",
  "mentors",
  "accounts",
  "responses",
  "team_locks",
  "fields",
  "lists",
  "actions",
] as const;

/** Les revues d'un fondateur ou d'une startup, la plus recente d'abord. */
const sortedReviews = (snap: FirebaseFirestore.QuerySnapshot) =>
  snap.docs.map((d) => d.data()).sort((a, b) => String(b.weekStartDayString).localeCompare(String(a.weekStartDayString)));

/** Les formulaires dont les reponses individuelles ne se lisent jamais ici, et les champs qu'ils ecrivent. */
const PRIVATE_FORM_KINDS = new Set<string>(["peer_feedback", "picks"]);
const isPrivateField = (dbField: string) => dbField.startsWith("peerRating.") || dbField.startsWith("picks.");

/** Un formulaire se lit par son lien (regle `forms` : public) ; un brouillon n'est montre qu'au staff. */
const canSeeForm = (role: string, form: Pick<Form, "status">) => role === "staff" || form.status !== "draft";

function requiredBatchId(input: { batchId?: string }, object: string): string {
  if (!input.batchId) throw badRequest("missing_argument", `\`batchId\` is required to list \`${object}\`.`, "batchId");
  return input.batchId;
}

/** La forme courte d'un formulaire : de quoi le choisir (`get form` pour ses questions). */
const shortForm = (f: Doc<Form>) => ({
  id: f.id,
  title: f.title,
  kind: f.kind,
  status: f.status,
  version: f.version,
  eventId: f.eventId,
  opensDateISOString: f.opensDateISOString,
  deadlineDateISOString: f.deadlineDateISOString,
  identityCheck: f.identityCheck,
  approval: f.approval,
});

/** Les objets qu'on lit seuls, sans sous-document. */
const SIMPLE_GETS = { program: COL.programs, batch: COL.batches, note: COL.notes } as const;
export const GET_OBJECTS = [...(Object.keys(SIMPLE_GETS) as (keyof typeof SIMPLE_GETS)[]), "founder", "startup", "event", "form"] as const;

/** Le type d'objet de chaque URL REST (`/v1/founders/{id}` -> `founder`) : le routeur ET la spec OpenAPI le lisent. */
export const REST_OBJECTS = {
  programs: "program",
  batches: "batch",
  founders: "founder",
  startups: "startup",
  events: "event",
  notes: "note",
  forms: "form",
} as const satisfies Record<string, (typeof GET_OBJECTS)[number]>;

export const ListInput = z
  .object({
    object: z.enum(LIST_OBJECTS),
    programId: z.string().min(1).optional().describe("batches: the program."),
    batchId: z.string().min(1).optional().describe("Required for founders, startups, events, forms, tasks."),
    eventId: z.string().min(1).optional().describe("forms: only this event's forms."),
    formId: z.string().min(1).optional().describe("responses: the form's answers (staff)."),
    pendingOnly: z.boolean().optional().describe("responses: only those with a value waiting for staff approval."),
    founderId: z.string().min(1).optional().describe("notes: notes about this founder (or their startup)."),
    startupId: z.string().min(1).optional().describe("notes: notes about this startup."),
    search: z.string().trim().min(1).optional().describe("Keep objects whose name contains this (accents and case ignored)."),
    includeArchived: z.boolean().optional(),
  })
  .strict();
export type ListInput = z.output<typeof ListInput>;

export const GetInput = z.object({ object: z.enum(GET_OBJECTS), id: z.string().min(1) }).strict();
export type GetInput = z.output<typeof GetInput>;

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
    const snaps = await db.getAll(...LIST_KEYS.map((k) => db.doc(docPaths.list(k))));
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

  if (object === "actions") return { object, items: actionsFor(caller, input.search) };

  if (object === "accounts") {
    if (!isStaffViewer(caller.viewer)) throw forbidden("not_visible", "Accounts are visible to staff only.");
    const search = input.search ? searchKey(input.search) : null;
    const rows = (await listAccounts()).filter((a) => !search || searchKey(`${a.displayName ?? ""} ${a.email ?? ""}`).includes(search));
    return { object, items: rows };
  }

  if (object === "mentors") {
    if (!isInsiderViewer(caller.viewer)) throw forbidden("not_visible", "Mentors are visible to staff and IC investors only.");
    const mentors = (await db.collection(COL.mentors).get()).docs
      .map((d) => withId<Mentor>(d))
      .filter((m) => input.includeArchived || !m.archivedDateISOString);
    const people = mentors.length ? await db.getAll(...mentors.map((m) => db.doc(docPaths.person(m.personId)))) : [];
    const search = input.search ? searchKey(input.search) : null;
    const items = mentors
      .map((m, i) => ({ id: m.id, name: (people[i]?.get("displayName") as string | undefined) ?? null, company: m.company, title: m.title, status: m.status, programIds: m.programIds }))
      .filter((m) => !search || searchKey(`${m.name ?? ""} ${m.company ?? ""}`).includes(search))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return { object, items };
  }

  if (object === "responses") {
    if (!isStaffViewer(caller.viewer)) throw forbidden("not_visible", "Form responses are visible to staff only.");
    if (!input.formId) throw badRequest("missing_argument", "`formId` is required to list `responses`.", "formId");
    const form = (await db.doc(docPaths.form(input.formId)).get()).data() as Form | undefined;
    if (!form) throw notFound("form_not_found", `No form \`${input.formId}\`.`, "formId");
    // ⛔️ Avis entre pairs et picks : jamais un par un (SPECS §4.8), ni leur formulaire, ni leurs valeurs ailleurs.
    if (PRIVATE_FORM_KINDS.has(form.kind)) throw forbidden("private_answers", "Peer ratings and picks are never read one by one: only their aggregates exist here.");
    // Une question qui ecrit un avis ou un pick, dans un autre formulaire : ses reponses sont retirees.
    const privateQuestions = new Set(form.questions.filter((q) => q.dbField && isPrivateField(q.dbField)).map((q) => q.id));
    const rows = (await db.collection(COL.formResponses).where("formId", "==", input.formId).get()).docs
      .map((d) => withId<FormResponse>(d))
      .filter((r) => !input.pendingOnly || r.status === "pending_approval")
      .sort((a, b) => b.submittedDateISOString.localeCompare(a.submittedDateISOString));
    return {
      object,
      items: rows.map((r) => ({
        id: r.id,
        submittedDateISOString: r.submittedDateISOString,
        respondent: r.respondentName ?? r.respondentFounderId ?? null,
        status: r.status,
        answers: Object.fromEntries(Object.entries(r.answers).filter(([key]) => !privateQuestions.has(parseAnswerKey(key).questionId))),
        writes: r.writes.map((w, writeIndex) => ({ writeIndex, ...w })).filter((w) => !isPrivateField(w.dbField)),
      })),
    };
  }

  if (object === "team_locks") {
    const batchId = requiredBatchId(input, object);
    if (roleOf(caller, batchId) !== "staff") throw forbidden("not_visible", "Lock my team answers are visible to staff only.");
    const [locks, founders] = await Promise.all([
      db.collection(TEAM_LOCKS_COLLECTION).where("batchId", "==", batchId).get(),
      db.collection(COL.founders).where("batchId", "==", batchId).get(),
    ]);
    const answers = locks.docs.map((d) => d.data() as TeamLock);
    const assigned = new Set(founders.docs.filter((d) => d.get("startupId")).map((d) => d.id));
    // Les equipes reciproques proposees (comme Admin > Startups), puis les reponses une par une.
    return { object, items: [{ groups: groupTeamLocks(answers, assigned), answers }] };
  }

  if (object === "tasks") {
    const batchId = requiredBatchId(input, object);
    // Regle `batchTasks` : le batch, le staff et les investors.
    if (roleOf(caller, batchId) === "public") throw forbidden("not_visible", "A batch's tasks are visible to its founders, staff and investors.");
    const tasks = (await db.collection(COL.batchTasks).where("batchId", "==", batchId).get()).docs
      .map((d) => withId<BatchTask>(d))
      .filter((t) => input.includeArchived || !t.archivedDateISOString)
      .sort((a, b) => a.order - b.order);
    return { object, items: tasks.map((t) => ({ id: t.id, title: t.title, description: t.description, linkUrl: t.linkUrl, order: t.order, archived: t.archivedDateISOString !== null })) };
  }

  if (object === "forms") {
    const batchId = requiredBatchId(input, object);
    const role = roleOf(caller, batchId);
    let q: FirebaseFirestore.Query = db.collection(COL.forms).where("batchId", "==", batchId);
    if (input.eventId) q = q.where("eventId", "==", input.eventId);
    const search = input.search ? searchKey(input.search) : null;
    const forms = (await q.get()).docs
      .map((d) => withId<Form>(d))
      .filter((f) => (input.includeArchived || !f.archivedDateISOString) && canSeeForm(role, f))
      .filter((f) => !search || searchKey(f.title).includes(search))
      .sort((a, b) => String(a.opensDateISOString ?? "~").localeCompare(String(b.opensDateISOString ?? "~")));
    return { object, items: forms.map(shortForm) };
  }

  const spec = SIMPLE_LISTS[object];
  let query: FirebaseFirestore.Query = db.collection(spec.col);
  if (spec.by) {
    const value = input[spec.by];
    if (!value) throw badRequest("missing_argument", `\`${spec.by}\` is required to list \`${object}\`.`, spec.by);
    query = query.where(spec.by, "==", value);
  }
  const search = input.search ? searchKey(input.search) : null;
  const docs = (await query.get()).docs
    .map((d) => withId<{ name?: string; archivedDateISOString?: string | null } & Record<string, unknown>>(d))
    .filter((d) => input.includeArchived || !d.archivedDateISOString)
    .filter((d) => !search || searchKey(String(d.name ?? "")).includes(search));
  // La carte d'un fondateur est publique (regle `founders`) : seuls les evenements se filtrent.
  const canSee = object === "events" ? await eventFilterFor(caller, input.batchId!) : null;
  const visible = canSee ? docs.filter((d) => canSee(d as unknown as PioneersEvent)) : docs;
  if (spec.sort) visible.sort((a, b) => String(a[spec.sort!] ?? "").localeCompare(String(b[spec.sort!] ?? "")));
  return { object, items: visible.map((d) => (spec.short as (x: unknown) => unknown)(d)) };
}

/**
 * Les evenements que l'appelant voit dans un batch, comme a l'ecran
 * (`EventsContext`) : le staff voit tout, brouillons compris ; les autres, les
 * evenements publies, et ceux a audience restreinte seulement s'ils y sont
 * invites (`canSeeEvent`). Un fondateur coute une lecture : sa startup.
 */
async function eventFilterFor(caller: Caller, batchId: string) {
  const role = roleOf(caller, batchId);
  const founderId = founderIdIn(caller, batchId);
  const startupId =
    role === "founder" && founderId ? (((await getFirestore().doc(docPaths.founder(founderId)).get()).get("startupId") as string | null) ?? null) : null;
  return (e: Pick<PioneersEvent, "status" | "archivedDateISOString" | "audience" | "guestFounderIds" | "startupIds">) =>
    role === "staff" || (isPublishedEvent(e) && canSeeEvent(role, founderId, startupId, e));
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
      const insider = isInsider(role);
      // La personne : lue pour l'insider ou si c'est le compte lui-meme (`founder.uid` est son rattachement).
      const scoreId = docIds.score("founder", id);
      const [person, directory, profile, internal, stats, score, scoreSignals, reviews, teamLock] = await Promise.all([
        readIf(insider || founder.uid === caller.uid, docPaths.person(founder.personId)),
        readIf(canReadFounderDirectory(role), docPaths.founderDirectory(id)),
        readIf(canReadFounderProfile(role, founderIdIn(caller, founder.batchId), id), docPaths.founderProfile(id)),
        readIf(insider, docPaths.founderInternal(id)),
        readIf(insider, `${COL.founderStats}/${id}`),
        // Le score et ce qui l'explique (regles `scores` : staff et investors ; `scoreSignals` : staff et IC).
        readIf(isStaffOrInvestor(role), `${COL.scores}/${scoreId}`),
        readIf(insider, `${COL.scoreSignals}/${scoreId}`),
        // Staff seulement (regles `founderReviews`, `teamLocks`) : ses revues de Weekly updates et sa reponse a Lock my team.
        role === "staff" ? db.collection(FOUNDER_REVIEWS_COLLECTION).where("founderId", "==", id).get() : null,
        readIf(role === "staff", teamLockPath(id)),
      ]);
      const personVisible = person && canReadPerson(role, caller.uid, person as { uid: string | null });
      return {
        object,
        ...withId(founderSnap),
        person: personVisible ? person : undefined,
        directory: directory && readDirectory(directory),
        profile,
        internal: internal && readFounderInternal(internal),
        stats,
        score,
        scoreSignals,
        weeklyReviews: reviews && sortedReviews(reviews),
        teamLock,
      };
    }

    case "startup": {
      // L'appartenance a l'equipe se decide sur la startup (`memberIds`) : elle se lit d'abord.
      const startupSnap = required(await db.doc(docPaths.startup(id)).get(), object, id);
      const startup = startupSnap.data() as Startup;
      const role = roleOf(caller, startup.batchId);
      const insideTeam = canReadStartupProfile(role, founderIdIn(caller, startup.batchId), startup);
      const scoreId = docIds.score("startup", id);
      const [profile, internal, checkins, score, scoreSignals, reviews] = await Promise.all([
        readIf(insideTeam, docPaths.startupProfile(id)),
        readIf(isInsider(role), docPaths.startupInternal(id)),
        insideTeam ? db.collection(COL.checkins).where("startupId", "==", id).get() : null,
        readIf(isStaffOrInvestor(role), `${COL.scores}/${scoreId}`),
        readIf(isInsider(role), `${COL.scoreSignals}/${scoreId}`),
        role === "staff" ? db.collection(STARTUP_REVIEWS_COLLECTION).where("startupId", "==", id).get() : null,
      ]);
      const recentCheckins = checkins?.docs
        .map((d) => withId<{ weekStartDayString: string }>(d))
        .sort((a, b) => b.weekStartDayString.localeCompare(a.weekStartDayString))
        .slice(0, 8);
      return { object, ...withId(startupSnap), profile, internal, recentCheckins, score, scoreSignals, weeklyReviews: reviews && sortedReviews(reviews) };
    }

    case "form": {
      const form = withId<Form>(required(await db.doc(docPaths.form(id)).get(), object, id));
      if (!canSeeForm(roleOf(caller, form.batchId), form)) throw hidden();
      return { object, ...form, url: form.status === "draft" ? null : formUrl(id) };
    }

    case "event": {
      const insider = isInsiderViewer(caller.viewer);
      const staff = isStaffViewer(caller.viewer);
      const [event, teams, attendance, submissions, eventForms, evaluations, leaderboard] = await Promise.all([
        db.doc(docPaths.event(id)).get(),
        db.collection(eventCollectionPaths.teams(id)).get(),
        insider ? db.collection(eventCollectionPaths.attendance(id)).get() : null,
        db.collection(eventCollectionPaths.submissions(id)).get(),
        db.collection(COL.forms).where("eventId", "==", id).get(),
        // Les notes du jury, une par une : le staff seulement (les fondateurs n'en voient que le classement).
        staff ? db.collection(eventCollectionPaths.evaluations(id)).get() : null,
        insider ? db.doc(docPaths.leaderboard(id)).get() : null,
      ]);
      const data = required(event, object, id).data() as PioneersEvent;
      if (!(await eventFilterFor(caller, data.batchId))(data)) throw notFound(`${object}_not_found`, `No ${object} with id \`${id}\`.`, "id");
      const role = roleOf(caller, data.batchId);
      // Ses formulaires : de quoi passer a `get form`.
      const forms = eventForms.docs.map((d) => withId<Form>(d)).filter((f) => !f.archivedDateISOString && canSeeForm(role, f));
      return {
        object,
        ...withId(event),
        forms: forms.map(shortForm),
        teams: teams.docs.map((d) => withId<{ publishedDateISOString: string | null }>(d)).filter((t) => canReadTeam(role, t)),
        attendance: attendance?.docs.map((d) => ({ founderId: d.id, status: d.get("status") })),
        submissions: submissions.docs.map((d) => withId(d)),
        evaluations: evaluations?.docs.map((d) => withId(d)),
        leaderboard: leaderboard?.exists ? leaderboard.data() : undefined,
      };
    }
  }
}
