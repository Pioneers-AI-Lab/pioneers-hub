import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import {
  attendanceWrites,
  EXTENSIBLE_LISTS,
  linkFounderWrites,
  listValuesWrite,
  moveInList,
  newBatch,
  newProgram,
  newTask,
  parseTaskLink,
  slugify,
  taskOrderWrites,
  unlinkFounderWrites,
} from "../../shared/admin/batch";
import { eventRoster } from "../../shared/attendance";
import { COL, docPaths, eventCollectionPaths } from "../../shared/collections";
import { archiveWrite, createWrite, isArchivedAs, mergeWrite } from "../../shared/docWrites";
import {
  ATTENDANCE_STATUSES,
  BATCH_MILESTONE_KEYS,
  type Attendance,
  type Batch,
  type BatchTask,
  type ClosedList,
  type Founder,
  type Person,
  type PioneersEvent,
  type Program,
  type User,
} from "../../shared/types";
import { badRequest, conflict, notFound } from "../../api/errors";
import type { Operation } from "../operations";
import { dayString } from "../schemas";
import { changesOf, mustRead, newDocId, readDoc, readWhere, stamped, staffOnly, writePlan } from "./writes";

// ----------------------------
// services/admin - taches, presence, programmes et batchs, rattachements
// ----------------------------
// Les gestes d'Admin > Tasks, Attendance, Batch settings et Founder profiles,
// calcules par shared/admin/batch.ts comme a l'ecran.

// ---- Taches du To do ------------------------------------------------------------

const taskLink = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .optional()
  .describe("A web address, or a page of the app (`/programs/...`).");

function linkOf(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const link = parseTaskLink(value);
  if (link === undefined) throw badRequest("invalid_link", "`linkUrl` must be a web address or a path of the app starting with `/`.", "linkUrl");
  return link;
}

const activeTasksOf = async (tx: FirebaseFirestore.Transaction, batchId: string) =>
  (await readWhere<BatchTask>(tx, COL.batchTasks, "batchId", batchId)).filter((t) => t.archivedDateISOString === null).sort((a, b) => a.order - b.order);

export const CreateTaskInput = z
  .object({ batchId: z.string().min(1), title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).nullable().optional(), linkUrl: taskLink })
  .strict();

export const createTask: Operation<typeof CreateTaskInput> = {
  name: "create_task",
  input: CreateTaskInput,
  allowed: staffOnly,
  async plan(tx, _caller, input) {
    const [batch, tasks] = await Promise.all([mustRead<Batch>(tx, docPaths.batch(input.batchId), "batch", "batchId"), activeTasksOf(tx, input.batchId)]);
    const task = newTask(batch, { title: input.title, description: input.description ?? null, linkUrl: linkOf(input.linkUrl) ?? null }, tasks);
    const id = newDocId(COL.batchTasks);
    return writePlan(
      { batch: batch.name, task: { title: task.title, description: task.description, linkUrl: task.linkUrl, position: tasks.length + 1 } },
      [createWrite(docPaths.batchTask(id), stamped(task, new Date().toISOString()))],
      { taskId: id },
    );
  },
};

export const UpdateTaskInput = z
  .object({ taskId: z.string().min(1), title: z.string().trim().min(1).max(200).optional(), description: z.string().trim().max(2000).nullable().optional(), linkUrl: taskLink })
  .strict();

export const updateTask: Operation<typeof UpdateTaskInput> = {
  name: "update_task",
  input: UpdateTaskInput,
  allowed: staffOnly,
  async plan(tx, _caller, { taskId, ...given }) {
    const task = await mustRead<BatchTask>(tx, docPaths.batchTask(taskId), "task", "taskId");
    const patch = { ...given, ...(given.linkUrl !== undefined ? { linkUrl: linkOf(given.linkUrl) } : {}) };
    const changes = changesOf(task, patch);
    return writePlan(
      { task: task.title, changes },
      [mergeWrite(docPaths.batchTask(taskId), { ...patch, updatedDateISOString: new Date().toISOString() })],
      { taskId },
      Object.keys(changes).length > 0,
    );
  },
};

export const MoveTaskInput = z.object({ taskId: z.string().min(1), position: z.number().int().min(1).describe("New rank in the To do, 1 = first.") }).strict();

export const moveTask: Operation<typeof MoveTaskInput> = {
  name: "move_task",
  input: MoveTaskInput,
  allowed: staffOnly,
  async plan(tx, _caller, { taskId, position }) {
    const task = await mustRead<BatchTask>(tx, docPaths.batchTask(taskId), "task", "taskId");
    const tasks = await activeTasksOf(tx, task.batchId);
    const from = tasks.findIndex((t) => t.id === taskId);
    if (from < 0) throw badRequest("archived", "This task is archived.", "taskId");
    const ordered = moveInList(tasks, from, position - 1);
    return writePlan({ task: task.title, order: ordered.map((t, i) => `${i + 1}. ${t.title}`) }, taskOrderWrites(ordered, new Date().toISOString()), { taskId });
  },
};

export const ArchiveTaskInput = z
  .object({ taskId: z.string().min(1), archived: z.boolean().describe("true: remove it from every founder's To do (their ticks stay). false: restore it.") })
  .strict();

export const archiveTask: Operation<typeof ArchiveTaskInput> = {
  name: "archive_task",
  input: ArchiveTaskInput,
  allowed: staffOnly,
  async plan(tx, _caller, { taskId, archived }) {
    const task = await mustRead<BatchTask>(tx, docPaths.batchTask(taskId), "task", "taskId");
    return writePlan({ task: task.title, archived }, [archiveWrite(docPaths.batchTask(taskId), archived, new Date().toISOString())], { taskId }, !isArchivedAs(task, archived));
  },
};

// ---- Presence ---------------------------------------------------------------------

export const MarkAttendanceInput = z
  .object({
    eventId: z.string().min(1),
    marks: z
      .array(z.object({ founderId: z.string().min(1), status: z.enum(ATTENDANCE_STATUSES) }).strict())
      .min(1)
      .max(100)
      .describe("Founders whose status changes. Everyone else expected is recorded present (present is the default)."),
  })
  .strict();

export const markAttendance: Operation<typeof MarkAttendanceInput> = {
  name: "mark_attendance",
  input: MarkAttendanceInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId, marks }) {
    const db = getFirestore();
    const [event, attendance] = await Promise.all([
      mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId"),
      tx.get(db.collection(eventCollectionPaths.attendance(eventId))),
    ]);
    const founders = await readWhere<Founder>(tx, COL.founders, "batchId", event.batchId);
    const roster = eventRoster(event.batchId, event, founders, attendance.docs.map((d) => d.data() as Attendance));
    const rowOf = new Map(roster.rows.map((r) => [r.founder.id, r]));
    const unexpected = marks.filter((m) => !rowOf.has(m.founderId)).map((m) => m.founderId);
    if (unexpected.length) throw badRequest("not_expected", `Not expected at this event: ${unexpected.join(", ")}.`, "marks");
    const changed = marks.map((m) => ({ ...m, row: rowOf.get(m.founderId)! })).filter((m) => m.row.status !== m.status);
    return writePlan(
      {
        event: event.name,
        changes: changed.map((m) => ({ founder: m.row.founder.name, from: m.row.status, to: m.status })),
        recordedPresent: roster.unmarkedIds.filter((id) => !changed.some((m) => m.founderId === id)).length,
      },
      attendanceWrites(eventId, changed, roster.unmarkedIds, caller.uid, new Date().toISOString()),
      { eventId },
      changed.length > 0,
    );
  },
};

// ---- Programmes, batchs, listes ---------------------------------------------------

const slugId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "A lowercase slug: letters, digits, dashes.");

export const CreateProgramInput = z
  .object({ name: z.string().trim().min(1).max(120), id: slugId.optional().describe("Default: from the name."), description: z.string().trim().max(2000).nullable().optional() })
  .strict();

export const createProgram: Operation<typeof CreateProgramInput> = {
  name: "create_program",
  input: CreateProgramInput,
  allowed: staffOnly,
  async plan(tx, _caller, input) {
    const id = input.id ?? slugify(input.name);
    if (await readDoc(tx, docPaths.program(id))) throw conflict("already_exists", `A program with the id \`${id}\` already exists.`);
    const program = newProgram({ name: input.name, description: input.description ?? null });
    return writePlan({ program: { id, ...program } }, [createWrite(docPaths.program(id), stamped(program, new Date().toISOString()) satisfies Program)], { programId: id });
  },
};

export const CreateBatchInput = z
  .object({
    programId: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    id: slugId.optional().describe("Default: from the name (`fall-2027`)."),
    startDayString: dayString,
    endDayString: dayString.nullable().optional(),
  })
  .strict();

export const createBatch: Operation<typeof CreateBatchInput> = {
  name: "create_batch",
  input: CreateBatchInput,
  allowed: staffOnly,
  async plan(tx, _caller, input) {
    const id = input.id ?? slugify(input.name);
    const [, existing] = await Promise.all([mustRead<Program>(tx, docPaths.program(input.programId), "program", "programId"), readDoc(tx, docPaths.batch(id))]);
    if (existing) throw conflict("already_exists", `A batch with the id \`${id}\` already exists.`);
    if (input.endDayString && input.endDayString < input.startDayString) throw badRequest("invalid_dates", "The batch must end after it starts.", "endDayString");
    const batch = newBatch({ programId: input.programId, name: input.name, startDayString: input.startDayString, endDayString: input.endDayString ?? null });
    return writePlan(
      { batch: { id, name: batch.name, programId: batch.programId, startDayString: batch.startDayString, endDayString: batch.endDayString, status: batch.status } },
      [createWrite(docPaths.batch(id), stamped(batch, new Date().toISOString()) satisfies Batch)],
      { batchId: id },
    );
  },
};

export const UpdateBatchInput = z
  .object({
    batchId: z.string().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    status: z.enum(["upcoming", "active", "completed"]).optional(),
    startDayString: dayString.optional(),
    endDayString: dayString.nullable().optional(),
    milestones: z
      .array(z.object({ key: z.enum(BATCH_MILESTONE_KEYS), dayString: dayString.nullable() }).strict())
      .max(BATCH_MILESTONE_KEYS.length)
      .optional()
      .describe("Milestone dates to change (others stay)."),
    leaderboardVisibility: z.enum(["visible", "hidden"]).optional().describe("Whether founders see the batch leaderboard."),
    googleCalendarId: z.string().trim().min(1).nullable().optional().describe("Link the batch to a Google Calendar (its events then come from it); null unlinks."),
  })
  .strict();

export const updateBatch: Operation<typeof UpdateBatchInput> = {
  name: "update_batch",
  input: UpdateBatchInput,
  allowed: staffOnly,
  async plan(tx, _caller, { batchId, milestones, leaderboardVisibility, googleCalendarId, ...given }) {
    const batch = await mustRead<Batch>(tx, docPaths.batch(batchId), "batch", "batchId");
    const patch: Partial<Batch> = { ...given };
    if (milestones) {
      const dayOf = new Map(milestones.map((m) => [m.key, m.dayString]));
      patch.milestones = batch.milestones.map((m) => (dayOf.has(m.key) ? { ...m, dayString: dayOf.get(m.key)! } : m));
    }
    const settings = Object.fromEntries(Object.entries({ leaderboardVisibility, googleCalendarId }).filter(([, v]) => v !== undefined));
    if (Object.keys(settings).length) patch.settings = { ...batch.settings, ...settings };
    const start = patch.startDayString ?? batch.startDayString;
    const end = patch.endDayString !== undefined ? patch.endDayString : batch.endDayString;
    if (end && end < start) throw badRequest("invalid_dates", "The batch must end after it starts.", "endDayString");
    const changes = changesOf(batch, patch);
    return writePlan(
      { batch: batch.name, changes, note: googleCalendarId ? "Run `sync_calendar` to bring its events in." : undefined },
      [mergeWrite(docPaths.batch(batchId), { ...patch, updatedDateISOString: new Date().toISOString() })],
      { batchId },
      Object.keys(changes).length > 0,
    );
  },
};

export const AddListValuesInput = z
  .object({ list: z.enum(EXTENSIBLE_LISTS), values: z.array(z.string().trim().min(1).max(120)).min(1).max(100) })
  .strict();

export const addListValues: Operation<typeof AddListValuesInput> = {
  name: "add_list_values",
  input: AddListValuesInput,
  allowed: staffOnly,
  async plan(tx, _caller, { list, values }) {
    const { added, write } = listValuesWrite(list, await readDoc<ClosedList>(tx, docPaths.list(list)), values, new Date().toISOString());
    return writePlan({ list, added, alreadyThere: values.length - added.length }, write ? [write] : [], { added });
  },
};

// ---- Rattachements (Admin > Founder profiles) -------------------------------------

export const LinkFounderInput = z
  .object({
    founderId: z.string().min(1),
    uid: z.string().min(1).optional().describe("The account (list `accounts`)."),
    email: z.email().optional().describe("Or the account's sign-in email."),
  })
  .strict();

export const linkFounder: Operation<typeof LinkFounderInput> = {
  name: "link_founder",
  input: LinkFounderInput,
  allowed: staffOnly,
  async plan(tx, _caller, input) {
    if (!input.uid === !input.email) throw badRequest("missing_argument", "Give the account's `uid` or its `email`, not both.", "uid");
    const [auth, founder] = await Promise.all([
      (input.uid ? getAuth().getUser(input.uid) : getAuth().getUserByEmail(input.email!.toLowerCase())).catch(() => null),
      mustRead<Founder>(tx, docPaths.founder(input.founderId), "founder", "founderId"),
    ]);
    if (!auth) throw notFound("account_not_found", "No account with this id or email: the person signs in once, or invite them (`invite_account`).", input.uid ? "uid" : "email");
    const [membership, person, user] = await Promise.all([
      readDoc(tx, docPaths.membership(founder.batchId, auth.uid)),
      readDoc<Person>(tx, docPaths.person(founder.personId)),
      readDoc<User>(tx, docPaths.user(auth.uid)),
    ]);
    const writes = linkFounderWrites({
      founder,
      founderId: founder.id,
      account: { uid: auth.uid, email: auth.email ?? null },
      hasMembership: membership !== undefined,
      person,
      userPersonId: user?.personId,
      now: new Date().toISOString(),
    });
    return writePlan(
      { founder: founder.name, account: auth.email ?? auth.uid, alsoLinksPerson: writes.some((w) => w.path === docPaths.person(founder.personId)) },
      writes,
      { founderId: founder.id, uid: auth.uid },
    );
  },
};

export const FounderIdInput = z.object({ founderId: z.string().min(1) }).strict();

export const unlinkFounder: Operation<typeof FounderIdInput> = {
  name: "unlink_founder",
  input: FounderIdInput,
  allowed: staffOnly,
  async plan(tx, _caller, { founderId }) {
    const founder = await mustRead<Founder>(tx, docPaths.founder(founderId), "founder", "founderId");
    if (!founder.uid) return writePlan({ founder: founder.name, linked: false }, [], { founderId });
    const uid = founder.uid;
    const [sameAccount, person, user] = await Promise.all([
      tx.get(getFirestore().collection(COL.founders).where("personId", "==", founder.personId).where("uid", "==", uid)),
      readDoc<Person>(tx, docPaths.person(founder.personId)),
      readDoc<User>(tx, docPaths.user(uid)),
    ]);
    const { writes, keepsPerson } = unlinkFounderWrites({
      founder: { ...founder, uid },
      sameAccountFounderIds: sameAccount.docs.map((d) => d.id),
      person,
      userPersonId: user?.personId,
      now: new Date().toISOString(),
    });
    return writePlan(
      { founder: founder.name, loses: "the account's access to this batch; the profile becomes claimable again", alsoUnlinksPerson: !keepsPerson },
      writes,
      { founderId },
    );
  },
};

export const ArchiveFounderInput = z
  .object({ founderId: z.string().min(1), archived: z.boolean().describe("true: a duplicate or a mistake, hidden from lists, draws, forms and /claim. false: restore it.") })
  .strict();

export const archiveFounder: Operation<typeof ArchiveFounderInput> = {
  name: "archive_founder",
  input: ArchiveFounderInput,
  allowed: staffOnly,
  async plan(tx, _caller, { founderId, archived }) {
    const founder = await mustRead<Founder>(tx, docPaths.founder(founderId), "founder", "founderId");
    if (archived && founder.uid) throw badRequest("linked", "This profile is linked to an account: unlink it first (`unlink_founder`).", "founderId");
    return writePlan({ founder: founder.name, archived }, [archiveWrite(docPaths.founder(founderId), archived, new Date().toISOString())], { founderId }, !isArchivedAs(founder, archived));
  },
};
