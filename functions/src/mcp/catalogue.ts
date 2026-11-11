import { z } from "zod";
import type { Caller } from "../api/caller";
import { badRequest } from "../api/errors";
import { applyPlan, previewPlan, type Operation } from "../services/operations";
import { addNote } from "../services/notes";
import { setFields } from "../services/fields";
import { getObject, GetInput, listObjects, ListInput, whoami } from "../services/read";
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
function writeTool<S extends z.ZodObject>(op: Operation<S>, meta: { name: string; title: string; description: string }): Tool {
  return {
    ...meta,
    schema: op.input.partial().extend({ planId: PLAN_ID.optional() }),
    annotations: WRITE,
    async run(caller, args) {
      const { planId, ...rest } = args;
      if (typeof planId === "string") {
        if (Object.keys(rest).length > 0) {
          throw badRequest("plan_only", "With `planId`, pass nothing else: the plan already holds the values.", "planId");
        }
        const applied = await applyPlan(op, caller, planId);
        return { applied: true, replayed: applied.replayed, result: applied.result };
      }
      const { planId: id, preview } = await previewPlan(op, caller, rest);
      if (!id) return { applied: false, nothingToWrite: true, preview };
      return { applied: false, planId: id, preview, next: "Show this to the user. If they confirm, call again with only `planId`." };
    },
  };
}

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
      "`batchId` is required for founders, startups and events; `programId` for batches; `founderId` or `startupId` for notes.\n" +
      "`fields` lists every writable field address for `pioneers_set_fields`, with the ids it needs and the values it accepts. " +
      "`lists` gives the accepted values of closed lists (skills, industries...).",
    schema: ListInput,
    annotations: READ_ONLY,
    run: (_caller, args) => listObjects(ListInput.parse(args)),
  },
  {
    name: "pioneers_get",
    title: "Get",
    description:
      "Returns ONE object in full by id. A founder comes with their person, Profile Book, private profile, internal data " +
      "and aggregated stats; a startup with its profile, internal assessment and recent weekly updates; an event with its " +
      "teams, attendance and submissions.",
    schema: GetInput,
    annotations: READ_ONLY,
    run: (_caller, args) => getObject(GetInput.parse(args)),
  },
  writeTool(setFields, {
    name: "pioneers_set_fields",
    title: "Set fields",
    description:
      "Writes field values for a founder, startup, week, event or team: profile data, a weekly update (`checkin.*`), " +
      "attendance (`attendance.status`), a submission. Several fields of the same subjects in one call.\n\n" +
      "Each field has its rule: some are only written when empty, lists are merged without duplicates. Closed-list values " +
      "may be given by key or label. Empty values are refused.",
  }),
  writeTool(addNote, {
    name: "pioneers_add_note",
    title: "Add note",
    description:
      "Adds an internal note (meeting notes, office hour, observation) to a startup or a founder. A startup note is also " +
      "attached to its members. Visible to staff and IC investors only.",
  }),
];

export const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Les declarations, telles que `tools/list` les rend : calculees une fois. */
export const DECLARED = TOOLS.map((tool) => {
  return { name: tool.name, title: tool.title, description: tool.description, inputSchema: toInputJsonSchema(tool.schema), annotations: tool.annotations };
});

export const TOOL_NAMES = TOOLS.map((t) => t.name);
