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
import {
  decideFormWrite,
  deleteJuryScore,
  publishRanking,
  resetJuryLink,
  setEventScoringAction,
  setOutstanding,
  setRankingMetric,
  setTeamResults,
  waiveLate,
} from "./admin/results";
import { createStartups, rateBackground, reviewFounder, reviewStartup, setAttendanceOptional } from "./admin/reviews";
import { drawTeams, editTeams, publishTeams, setMatching } from "./admin/teams";
import { scoreJury } from "./admin/jury";

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
  { op: setAttendanceOptional, description: "Make an event's attendance optional (still taken, not counted in Engagement), or required again." },
  { op: setMatching, description: "Give an event a matching (work teams or tables, group size) or remove it, before its groups are published." },
  { op: drawTeams, description: "Draw an event's groups as a draft (same seed = same draw): history, shortlists, absences, pairs to keep apart or together." },
  { op: publishTeams, description: "Publish the drafted groups: founders see their group, team histories are recorded." },
  { op: editTeams, description: "Change groups (draft or published): swap, move, late arrival, leader, new group. Published group ids stay." },
  { op: setTeamResults, description: "Correct a team's results (metrics, product link, proofs, notes), as a staff correction." },
  { op: waiveLate, description: "Count (or not) a team's late Submission." },
  { op: setOutstanding, description: "Give (or remove) the Outstanding mention to a team with the grid's maximum." },
  { op: scoreJury, description: "Score every team or startup of a jury form at once, as YOUR staff score, with a justification per criterion (read `pioneers_get` `jury_sheet` first)." },
  { op: deleteJuryScore, description: "Delete a jury score entered by mistake (kept in the audit log)." },
  { op: resetJuryLink, description: "Replace an event's shared jury link (the old one stops working)." },
  { op: setEventScoringAction, description: "Set an event's scoring grid (jury criteria points, tie-breaks), or remove it." },
  { op: setRankingMetric, description: "Rank an event by one team metric, or by jury scores." },
  { op: publishRanking, description: "Publish (or hide) an event's ranking; the batch's scores follow." },
  { op: decideFormWrite, description: "Approve or reject a form answer waiting for staff approval (list `responses`)." },
  { op: reviewFounder, description: "Review a founder's Weekly update (goal ambitious, reached, problem validated)." },
  { op: reviewStartup, description: "Review a startup's Weekly update (Traction and Progress grid)." },
  { op: rateBackground, description: "Rate a founder's Background (the staff rating next to Claude's proposal)." },
  { op: createStartups, description: "Create the confirmed startups of a batch (from Lock my team): startups, members, team history." },
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

/**
 * Les actions de cet appelant. Sans `search` : nom et description (la liste
 * entiere, avec ses schemas, depasserait ce qu'un outil rend). Avec `search` (un
 * nom ou un mot) : les actions qui correspondent, AVEC leurs arguments.
 */
export function actionsFor(caller: Caller, search?: string) {
  const mine = declaredActions().filter((a) => a.op.allowed(caller));
  if (!search) return mine.map((a) => ({ action: a.op.name, description: a.description }));
  const q = search.toLowerCase();
  const exact = mine.filter((a) => a.op.name === q);
  return (exact.length ? exact : mine.filter((a) => a.op.name.includes(q) || a.description.toLowerCase().includes(q))).map((a) => ({
    action: a.op.name,
    description: a.description,
    args: a.args,
  }));
}

export const anyActionFor = (caller: Caller) => ACTION_LIST.some((a) => a.op.allowed(caller));
