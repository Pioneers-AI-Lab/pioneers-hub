import { z } from "zod";
import type { Caller } from "../api/caller";
import { badRequest } from "../api/errors";
import { applyPlan, previewPlan, type Operation } from "../services/operations";
import { createEvent } from "../services/eventCreate";
import { createForm } from "../services/formCreate";
import { addNote } from "../services/notes";
import { setFields } from "../services/fields";
import { getObject, GetInput, listObjects, ListInput, whoami } from "../services/read";
import { ACTION_NAMES, actionOf, anyActionFor } from "../services/actions";
import { GUIDE_TOPICS, type GuideTopic } from "./guide";
import { toInputJsonSchema } from "../services/schemas";

// ----------------------------
// mcp - LE catalogue
// ----------------------------
// Decisions reprises de Trippple (`mcp/catalogue.js`), mesurees la-bas :
//   - PEU D'OUTILS, par GESTE et non par endpoint. La selection d'outil
//     s'effondre quand le catalogue grandit, et il se relit a chaque tour.
//     La voie la moins chere pour une capacite de plus est un type d'objet de
//     plus dans `list` / `get`, pas un outil.
//   - Lire generiquement, ecrire nommement.
//   - Prefixe `pioneers_` : des verbes nus (`list`, `get`) seraient ambigus dans
//     une session qui charge plusieurs serveurs.
//   - Pas de pagination du catalogue, pas d'`outputSchema`.
//   - Le schema d'entree est TIRE DU CONTRAT zod (`z.toJSONSchema`) : la meme
//     enonciation valide /v1 et le MCP.

type Tool = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodType;
  annotations: Record<string, boolean>;
  /**
   * Le catalogue SUIT LES DROITS (lecon de Trippple) : un outil que le compte
   * ne peut pas utiliser n'existe pas pour lui. Absent = visible de tous.
   * Le catalogue n'est pas une securite : chaque service verifie a l'appel.
   */
  visibleTo?: (caller: Caller) => boolean;
  run: (caller: Caller, args: Record<string, unknown>) => Promise<unknown>;
};



const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
// Une ecriture confirmee par `planId` se rejoue sans effet : le client peut le savoir.
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const PLAN_ID = z.string().min(1).describe("Returned by the preview. Pass it ALONE, after the user confirmed.");

/**
 * Un outil d'ecriture en deux temps : sans `planId`, il previsualise ; avec
 * `planId` seul, il applique ce qui a ete montre.
 */
/**
 * Le premier appel (apercu) ou le second (`planId` seul) d'une ecriture. `op` :
 * l'operation de l'outil, ou une table nom -> operation (`pioneers_run`).
 */
async function previewOrApply(op: Operation | ((name: string) => Operation | undefined), caller: Caller, args: Record<string, unknown>, planId: unknown) {
  if (typeof planId === "string") {
    const applied = await applyPlan(op, caller, planId);
    return { applied: true, replayed: applied.replayed, result: applied.result };
  }
  if (typeof op === "function") throw badRequest("missing_argument", "Give `action`.", "action");
  const { planId: id, preview } = await previewPlan(op, caller, args);
  if (!id) return { applied: false, nothingToWrite: true, preview };
  return { applied: false, planId: id, preview, next: "Show this to the user. If they confirm, call again with only `planId`." };
}

const planOnly = () => badRequest("plan_only", "With `planId`, pass nothing else: the plan already holds the values.", "planId");

function writeTool<S extends z.ZodObject>(
  op: Operation<S>,
  meta: { name: string; title: string; description: string },
): Tool {
  return {
    ...meta,
    // La porte de l'operation elle-meme : le catalogue ne peut pas diverger du service.
    visibleTo: (caller) => op.allowed(caller),
    schema: op.input.partial().extend({ planId: PLAN_ID.optional() }),
    annotations: WRITE,
    async run(caller, args) {
      const { planId, ...rest } = args;
      if (typeof planId === "string" && Object.keys(rest).length > 0) throw planOnly();
      return previewOrApply(op, caller, rest, planId);
    },
  };
}

const RunInput = z
  .object({
    action: z.enum(ACTION_NAMES).optional().describe("The action. Its arguments: `pioneers_list` with `object: \"actions\"` and `search: \"<action>\"`."),
    args: z.record(z.string(), z.unknown()).optional().describe("The action's arguments."),
    planId: PLAN_ID.optional(),
  })
  .strict();

const GuideInput = z
  .object({ topic: z.enum(Object.keys(GUIDE_TOPICS) as [GuideTopic, ...GuideTopic[]]).optional().describe("Omit to get the list of topics.") })
  .strict();

const TOOLS: Tool[] = [
  {
    name: "pioneers_whoami",
    title: "Who am I",
    description: "Returns the connected account, its roles, and the programs and batches with their ids. Call it first.",
    schema: z.object({}).strict(),
    annotations: READ_ONLY,
    run: (caller) => whoami(caller),
  },
  {
    name: "pioneers_list",
    title: "List",
    description:
      "Lists objects of one type in SHORT form, enough to pick one; call `pioneers_get` for the full object.\n\n" +
      "`batchId` is required for founders, startups, events, forms and tasks; `programId` for batches; `founderId` or `startupId` for notes.\n" +
      "`fields` lists every writable field address for `pioneers_set_fields`, with the ids it needs and the values it accepts. " +
      "`lists` gives the accepted values of closed lists (skills, industries...). `actions` lists the admin actions of `pioneers_run`; with `search` (an action's name), its arguments.",
    schema: ListInput,
    annotations: READ_ONLY,
    run: (caller, args) => listObjects(caller, ListInput.parse(args)),
  },
  {
    name: "pioneers_get",
    title: "Get",
    description:
      "Returns ONE object in full by id, with what YOUR role may see. A founder comes with their person, Profile Book, " +
      "private profile, internal data and aggregated stats; a startup with its profile, internal assessment and recent " +
      "weekly updates; an event with its forms, teams, attendance and submissions; a form with its questions; a `jury_sheet` (id = the event's) with everything to score its jury. A missing part is one you cannot see.",
    schema: GetInput,
    annotations: READ_ONLY,
    run: (caller, args) => getObject(caller, GetInput.parse(args)),
  },
  writeTool(setFields, {
    name: "pioneers_set_fields",
    title: "Set fields",
    description:
      "Writes field values for a founder, startup, week, event or team: profile data, a weekly update (`checkin.*`), " +
      "attendance (`attendance.status`), a submission. Several fields of the same subjects in one call.\n\n" +
      "Each field has its rule: some are only written when empty, lists are merged without duplicates. Closed-list values " +
      "may be given by key or label. Empty values are refused. A founder changes only their own profile fields.",
  }),
  writeTool(addNote, {
    name: "pioneers_add_note",
    title: "Add note",
    description:
      "Adds an internal note (meeting notes, office hour, observation) to a startup or a founder. A startup note is also " +
      "attached to its members. Visible to staff and IC investors only.",
  }),
  writeTool(createEvent, {
    name: "pioneers_create_event",
    title: "Create event",
    description:
      "Creates an event in a batch: blank (an office hour: kind `meeting`), or from a model, a pack that also creates its " +
      "matching, scoring and forms (a hackathon: teams, submission, peer rating, jury; a pitch: pitch deck, jury), with the startups and mentors concerned. " +
      "Retired models are refused. `scheduled` shows it to founders and publishes its forms.",
  }),
  {
    name: "pioneers_run",
    title: "Run an admin action",
    description:
      "Runs one named admin action, everything staff do in Admin: events (edit, move, archive, model); matching and groups (draw, publish, " +
      "retouch); team results, jury scores, scoring grid and ranking; forms (edit, open, close, copy, archive, approve pending answers); " +
      "attendance; weekly update reviews, Background, startups; To do tasks; programs and batches; account links and accounts; calendar sync; recompute scores.\n\n" +
      "First list the actions (`pioneers_list` `actions`), then read the arguments of the one you need (`search: \"<action>\"`). Same two calls as every write: without `planId` it previews; then `planId` alone applies.",
    schema: RunInput,
    annotations: WRITE,
    visibleTo: anyActionFor,
    async run(caller, raw) {
      const { action, args, planId } = RunInput.parse(raw);
      if (typeof planId === "string") {
        if (action || args) throw planOnly();
        // L'action se lit dans le plan lui-meme (une lecture, dans la transaction d'applyPlan).
        return previewOrApply((name) => actionOf(name)?.op, caller, {}, planId);
      }
      if (!action) throw badRequest("missing_argument", "Give `action` and its `args` (list `actions`).", "action");
      return previewOrApply(actionOf(action)!.op, caller, args ?? {}, undefined);
    },
  },
  {
    name: "pioneers_guide",
    title: "Guide",
    description:
      "How the data fits together, read before changing it: the model and who sees what, events (matching, teams, forms, results), forms, " +
      "scores (derived: fix the input, then recompute), what is private, and step-by-step recipes for common corrections.",
    schema: GuideInput,
    annotations: READ_ONLY,
    // Le guide de l'Admin : pour qui a ses actions.
    visibleTo: anyActionFor,
    run: async (_caller, args) => {
      const { topic } = GuideInput.parse(args);
      if (!topic) return { topics: Object.entries(GUIDE_TOPICS).map(([key, t]) => ({ topic: key, title: t.title, summary: t.summary })) };
      const t = GUIDE_TOPICS[topic];
      return { topic, title: t.title, body: t.body };
    },
  },
  writeTool(createForm, {
    name: "pioneers_create_form",
    title: "Create form",
    description:
      "Creates a form from a model (Lock my team, week retro, program end...) or from your questions. A question can write its " +
      "answer to a database field (list `fields`). Created as a draft to review in Admin > Forms, or published at once " +
      "with `publish: true` (the result gives the link to share).",
  }),
];

/** Une declaration, telle que `tools/list` la rend : calculee une fois par outil. */
const declaration = (tool: Tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: toInputJsonSchema(tool.schema),
  annotations: tool.annotations,
});

export type DeclaredTool = Tool & { declaration: ReturnType<typeof declaration> };

const DECLARED_TOOLS: DeclaredTool[] = TOOLS.map((tool) => ({ ...tool, declaration: declaration(tool) }));

/** Les outils de cet appelant : le catalogue SUIT SES DROITS. */
export const toolsFor = (caller: Caller): DeclaredTool[] => DECLARED_TOOLS.filter((t) => !t.visibleTo || t.visibleTo(caller));
