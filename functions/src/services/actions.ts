import type { Caller } from "../api/caller";
import type { Operation } from "./operations";
import { toInputJsonSchema } from "./schemas";
import { inviteAccount, recomputeScores, setAccountAccess, setAccountDisabled, syncCalendar } from "./admin/accounts";
import {
  addListValues,
  archiveFounder,
  archiveTask,
  createBatch,
  createProgram,
  createTask,
  linkFounder,
  markAttendance,
  moveTask,
  unlinkFounder,
  updateBatch,
  updateTask,
} from "./admin/batch";
import { applyEventTemplate, archiveEvent, updateEvent } from "./admin/events";
import { archiveForm, duplicateForm, setFormStatus, updateForm } from "./admin/forms";

// ----------------------------
// services - les ACTIONS de l'Admin, par nom
// ----------------------------
// Un geste de l'Admin = une action nommee. Le MCP les sert par UN outil
// (`pioneers_run` : un outil par bouton ferait exploser le catalogue, que le
// modele relit a chaque tour), /v1 par `POST /v1/actions/{action}`. Leurs
// arguments se lisent par `list actions` (comme `list fields` pour les champs).
// Chaque action est une `Operation` : apercu, confirmation, audit.

type Described = { op: Operation; description: string };

const ACTION_LIST: Described[] = [
  { op: updateEvent, description: "Change an event's settings (time, place, description, status, audience, invited founders, mentors, startups). A new time also moves its forms and the attached Debrief." },
  { op: archiveEvent, description: "Archive an event (hidden everywhere, open forms closed) or restore it (forms reopened)." },
  { op: applyEventTemplate, description: "Give an existing event (one from Google Calendar) a model: its label, matching and the forms of the pack it lacks." },
  { op: updateForm, description: "Edit a form: title, description, dates, identity, approval, event, questions. A published form whose questions change gets a new version." },
  { op: setFormStatus, description: "Open (publishes a draft) or close a form." },
  { op: duplicateForm, description: "Copy a form as a draft; a weekly form gives next week's (dates one week later)." },
  { op: archiveForm, description: "Archive a form (closed, hidden) or restore it." },
  { op: createTask, description: "Add a task at the end of every founder's To do in a batch." },
  { op: updateTask, description: "Change a To do task's title, description or link." },
  { op: moveTask, description: "Move a To do task to another rank." },
  { op: archiveTask, description: "Remove a task from the To do (archive) or restore it." },
  { op: markAttendance, description: "Record attendance at an event: the founders given get their status, everyone else expected is recorded present." },
  { op: createProgram, description: "Create a program." },
  { op: createBatch, description: "Create a batch in a program (upcoming, with its milestones)." },
  { op: updateBatch, description: "Change a batch: name, dates, status, milestone dates, leaderboard visibility, Google Calendar." },
  { op: addListValues, description: "Add values to a closed list (skills, industries, position fit)." },
  { op: linkFounder, description: "Link a founder profile to an account (staff link, as in Admin > Founder profiles)." },
  { op: unlinkFounder, description: "Unlink a founder profile from its account: the account loses the batch, the profile becomes claimable." },
  { op: archiveFounder, description: "Archive a founder profile (duplicate, mistake) or restore it." },
  { op: inviteAccount, description: "Create (or update) an account by email with its access: investor, mentor, or plain. Never staff." },
  { op: setAccountAccess, description: "Change a non-staff account's access (investor IC or portfolio, mentor)." },
  { op: setAccountDisabled, description: "Block or allow a non-staff account's sign-in." },
  { op: syncCalendar, description: "Sync a batch's events from its Google Calendar now (otherwise automatic)." },
  { op: recomputeScores, description: "Recompute a batch's scores from its current data, after a correction (otherwise every night)." },
];

const BY_NAME = new Map(ACTION_LIST.map((a) => [a.op.name, a]));

/** L'action de ce nom, ou `undefined` (un nom vient d'une URL ou d'un plan : jamais une cle d'objet). */
export const actionOf = (name: string): Described | undefined => BY_NAME.get(name);

export const ACTION_NAMES = ACTION_LIST.map((a) => a.op.name) as [string, ...string[]];

/** Chaque action avec ses arguments en schema JSON : calcule au premier besoin (`list actions`, spec OpenAPI), pas au demarrage. */
let declared: (Described & { args: Record<string, unknown> })[] | null = null;
export const declaredActions = () => (declared ??= ACTION_LIST.map((a) => ({ ...a, args: toInputJsonSchema(a.op.input) })));

export const actionsFor = (caller: Caller) =>
  declaredActions()
    .filter((a) => a.op.allowed(caller))
    .map((a) => ({ action: a.op.name, description: a.description, args: a.args }));

export const anyActionFor = (caller: Caller) => ACTION_LIST.some((a) => a.op.allowed(caller));
