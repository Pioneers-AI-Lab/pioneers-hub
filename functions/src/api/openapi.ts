import { z } from "zod";
import { AddNoteInput } from "../services/notes";
import { SetFieldsInput } from "../services/fields";
import { ListInput, REST_OBJECTS } from "../services/read";
import { toInputJsonSchema } from "../services/schemas";
import { PUBLIC_BASE_URL } from "./config";

// ----------------------------
// api - la spec OpenAPI de /v1, TIREE DES CONTRATS
// ----------------------------
// SPECS §4.7 : « documentation OpenAPI generee automatiquement, pour brancher
// un nouvel outil sans developpeur ». Les schemas sont ceux qui valident les
// requetes (zod -> JSON Schema 2020-12, que l'OpenAPI 3.1 parle) : la
// documentation ne peut pas mentir sur ce que l'API accepte.

const schema = toInputJsonSchema;

const errorResponse = { description: "Refusal: `error.code`, `error.message`, and `error.field` when a field is at fault.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
/** Les refus possibles d'une route, tous dans l'enveloppe `Error`. */
const errors = (...codes: number[]) => Object.fromEntries(codes.map((code) => [String(code), errorResponse]));
const ok = (description: string) => ({ description, content: { "application/json": { schema: { type: "object" } } } });

const writeOperation = (summary: string, description: string, body: z.ZodType) => ({
  summary,
  description: `${description}\n\nWith \`?dryRun=true\`, nothing is written: the response shows the preview. With an \`Idempotency-Key\` header, replaying the same request returns the same response (24 h) instead of writing twice.`,
  parameters: [
    { name: "dryRun", in: "query", schema: { type: "boolean" }, description: "Preview only, write nothing." },
    { name: "Idempotency-Key", in: "header", schema: { type: "string", maxLength: 255 }, description: "Makes a retried request safe." },
  ],
  requestBody: { required: true, content: { "application/json": { schema: schema(body) } } },
  responses: {
    "200": ok("Preview (`dryRun`), nothing to write, or a replayed response (`replayed: true`)."),
    "201": ok("Written. `result` says what changed."),
    ...errors(400, 401, 403, 404, 409),
  },
});

function build() {
  const list = schema(ListInput) as { properties: Record<string, Record<string, unknown>> };
  const { object: objectParam, ...queryParams } = list.properties;

  return {
    openapi: "3.1.0",
    info: {
      title: "Pioneers Hub API",
      version: "1",
      description:
        "Read and fill the Pioneers batch database. Authenticate with a personal API key (`Authorization: Bearer ph_live_...`), created in Pioneers Hub > API & MCP. Any Pioneers Hub account can create one; it acts with the rights of its owner (what they see and may change in the app). Claude connects to the MCP server at `/mcp` (OAuth) instead.",
    },
    servers: [{ url: PUBLIC_BASE_URL }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "A `ph_live_...` API key." } },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: { code: { type: "string" }, message: { type: "string" }, field: { type: ["string", "null"] }, requestId: { type: "string" } },
            },
          },
        },
      },
    },
    paths: {
      "/v1/me": { get: { summary: "Who am I", description: "The key owner, their roles, and the programs and batches with their ids.", responses: { "200": ok("The account."), ...errors(401) } } },
      "/v1/{object}": {
        get: {
          summary: "List",
          description:
            "A SHORT form of each object, enough to pick one. `batchId` is required for founders, startups and events; `programId` for batches; `founderId` or `startupId` for notes. `fields` lists every writable field address with what it needs and accepts; `lists` the accepted values of closed lists.",
          parameters: [
            { name: "object", in: "path", required: true, schema: objectParam },
            ...Object.entries(queryParams).map(([name, s]) => ({ name, in: "query", schema: s, description: s.description })),
          ],
          responses: { "200": ok("`{ object, items }`."), ...errors(400, 401) },
        },
      },
      "/v1/{object}/{id}": {
        get: {
          summary: "Get",
          description: "One object in full. A founder comes with person, Profile Book, private profile, internal data and stats; a startup with profile, internal assessment and recent weekly updates; an event with teams, attendance and submissions.",
          parameters: [
            { name: "object", in: "path", required: true, schema: { type: "string", enum: Object.keys(REST_OBJECTS) } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": ok("The object."), ...errors(401, 404) },
        },
      },
      "/v1/fields": {
        post: writeOperation(
          "Set fields",
          "Writes field values for a founder, startup, week, event or team, through the field registry (`GET /v1/fields`): profile data, weekly update (`checkin.*`), attendance, submission. Each field has its write rule (fill when empty, overwrite, merge lists). Empty values are refused. All or nothing: one invalid value refuses the request, naming the field.",
          SetFieldsInput,
        ),
      },
      "/v1/notes": {
        post: writeOperation("Add note", "Adds an internal note to a startup (also attached to its members) or a founder.", AddNoteInput),
      },
    },
  };
}

let cached: ReturnType<typeof build> | null = null;

/** La spec, construite une fois par instance. */
export const openApiDocument = () => (cached ??= build());
