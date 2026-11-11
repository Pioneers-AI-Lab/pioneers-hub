import { randomUUID } from "node:crypto";
import express, { Router, type Request } from "express";
import { mcpRouter } from "../mcp";
import { oauthRouter } from "../oauth/router";
import { addNote } from "../services/notes";
import { setFields } from "../services/fields";
import { runOperation, type Operation } from "../services/operations";
import { getObject, GetInput, listObjects, ListInput, REST_OBJECTS, whoami } from "../services/read";
import { requireCaller } from "./caller";
import { openApiDocument } from "./openapi";
import { errorHandler, notFound, route } from "./errors";

// ----------------------------
// api - l'application HTTP
// ----------------------------
// Une seule fonction `api` (europe-west4), servie par le site Hosting
// `pioneers-hub-api` (firebase.json). Deux surfaces sur la meme pile :
//
//   /v1    REST pour les scripts et integrations (cles `ph_live_`)
//   /mcp   le serveur MCP pour Claude
//
// Les deux appellent les MEMES services (functions/src/services) : une regle
// metier n'existe qu'une fois.

const REQUEST_ID_HEADER = "x-request-id";

export const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  req.requestId = (typeof req.headers[REQUEST_ID_HEADER] === "string" && req.headers[REQUEST_ID_HEADER]) || randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.requestId);
  // ⛔️ Le CDN de Firebase Hosting met en cache une reponse de fonction qui le
  // permet : aucune reponse de cette API ne doit l'etre.
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Cloud Functions analyse deja le JSON (`req.body`) ; l'emulateur Hosting et
// les tests locaux, pas toujours.
const jsonParser = express.json({ limit: "2mb" });
const formParser = express.urlencoded({ extended: false });
app.use((req, res, next) => (req.body === undefined ? jsonParser(req, res, () => formParser(req, res, next)) : next()));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// OAuth AVANT tout ce qui exige un justificatif : on le lit pour en obtenir un.
app.use(oauthRouter);
app.use("/mcp", mcpRouter);

// ---- /v1 -----------------------------------------------------------------------

const v1 = Router();
v1.use(requireCaller("api"));

const idempotencyKeyOf = (req: Request) => {
  const value = req.headers["idempotency-key"];
  return typeof value === "string" ? value : null;
};

/** Une ecriture : `?dryRun=true` rend l'apercu sans rien ecrire ; `Idempotency-Key` rend un rejeu sans effet. */
function writeRoute(op: Operation) {
  return route(async (req, res) => {
    const out = await runOperation(op, req.caller!, req.body, {
      dryRun: req.query.dryRun === "true",
      idempotencyKey: idempotencyKeyOf(req),
    });
    res.status(out.applied && !out.replayed ? 201 : 200).json(out);
  });
}

v1.post("/fields", writeRoute(setFields));
v1.post("/notes", writeRoute(addNote));

v1.get(
  "/me",
  route(async (req, res) => {
    res.json(await whoami(req.caller!));
  }),
);

// `GET /v1/founders?batchId=...` : liste ; `GET /v1/founders/{id}` : un objet (`REST_OBJECTS`).
v1.get(
  "/:object",
  route(async (req, res) => {
    const query = { ...req.query } as Record<string, unknown>;
    if (query.includeArchived !== undefined) query.includeArchived = query.includeArchived === "true";
    res.json(await listObjects(ListInput.parse({ ...query, object: req.params.object })));
  }),
);

v1.get(
  "/:object/:id",
  route(async (req, res) => {
    const object = REST_OBJECTS[String(req.params.object) as keyof typeof REST_OBJECTS];
    if (!object) throw notFound("unknown_object", `No object type \`${req.params.object}\`. Types: ${Object.keys(REST_OBJECTS).join(", ")}.`);
    res.json(await getObject(GetInput.parse({ object, id: req.params.id })));
  }),
);

// La spec est publique : on la lit pour savoir comment s'authentifier.
// ⛔️ SEULE EXCEPTION a `no-store` : elle est la meme pour tous, sans
// authentification, et ne change qu'a un deploiement (qui vide le CDN de
// Hosting). Le CDN la sert sans reveiller la fonction.
app.get("/v1/openapi.json", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.json(openApiDocument());
});
app.use("/v1", v1);

app.use((req, _res, next) => next(notFound("not_found", `No route \`${req.method} ${req.path}\`. MCP: POST /mcp. REST: /v1.`)));
app.use(errorHandler);

