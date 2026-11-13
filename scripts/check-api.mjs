// ----------------------------
// Verification de l API (/v1) et du serveur MCP, de bout en bout (emulateurs + seed)
// ----------------------------
// npm run check:api  (emulateurs decales de +200, seed, puis ce script)
//
// Passe par la reecriture Hosting, comme en production : https://pioneers-hub-api.web.app.
// Code de sortie 1 au premier ecart.
import { createRequire } from "node:module";
const require = createRequire(new URL("../functions/package.json", import.meta.url));

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT = "demo-pioneers-hub";
initializeApp({ projectId: PROJECT });
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
// Ports decales (scripts/emulators-check-config.mjs) : +200, ou CHECK_PORT_OFFSET.
const OFFSET = Number(process.env.CHECK_PORT_OFFSET ?? 200);
const FUNCS = `http://127.0.0.1:${5101 + OFFSET}/${PROJECT}/europe-west4`;
const HOSTING = `http://127.0.0.1:${5102 + OFFSET}`;
let failures = 0;
const check = (cond, label, extra) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${!cond && extra !== undefined ? " -> " + JSON.stringify(extra).slice(0, 600) : ""}`);
  if (!cond) failures++;
};

async function idToken(uid) {
  const token = await getAuth().createCustomToken(uid);
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}
async function callable(name, token, data) {
  const r = await fetch(`${FUNCS}/${name}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ data }) });
  return r.json();
}
let rpcId = 0;
async function mcp(key, method, params) {
  const r = await fetch(`${HOSTING}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}`, "mcp-protocol-version": "2099-01-01" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text }; }
}
const call = async (key, name, args) => {
  const r = await mcp(key, "tools/call", { name, arguments: args });
  const res = r.body.result;
  const text = res?.content?.[0]?.text;
  let parsed = text; try { parsed = JSON.parse(text); } catch {}
  return { isError: !!res?.isError, data: parsed, raw: r };
};

(async () => {
  const staff = await idToken("staff-1");
  const created = await callable("createApiKey", staff, { name: "e2e" });
  const key = created.result?.key;
  check(typeof key === "string" && key.startsWith("ph_live_"), "createApiKey returns a ph_live_ key", created);

  const icToken = await idToken("ic-1");
  const anonymous = await (await fetch(`${FUNCS}/createApiKey`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { name: "x" } }) })).json();
  check(anonymous.error?.status === "UNAUTHENTICATED", "createApiKey requires a signed-in account", anonymous);

  // /v1
  let r = await fetch(`${HOSTING}/v1/me`, { headers: { authorization: `Bearer ${key}` } });
  const me = await r.json();
  check(r.status === 200 && me.programs?.length > 0, "GET /v1/me via Hosting rewrite", me);
  check(r.headers.get("cache-control") === "no-store", "Cache-Control: no-store");
  r = await fetch(`${HOSTING}/v1/me`);
  check(r.status === 401 && r.headers.get("www-authenticate"), "401 + WWW-Authenticate without credentials");
  r = await fetch(`${HOSTING}/v1/me`, { headers: { authorization: `Bearer ${icToken}` } });
  check(r.status === 200, "an IC investor's ID token works too (with its own rights)");
  r = await fetch(`${HOSTING}/v1/founders?batchId=fall-2026`, { headers: { authorization: `Bearer ${key}` } });
  const founders = (await r.json()).items;
  check(founders?.length > 0, `GET /v1/founders lists ${founders?.length} founders`);
  const founder = founders.find((f) => f.startupId) ?? founders[0];

  // MCP
  const init = await mcp(key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
  check(init.status === 200 && init.body.result?.serverInfo?.name === "pioneers-hub", "initialize (despite an unknown protocol version header)", init);
  check(typeof init.body.result?.instructions === "string", "instructions sent");
  const list = await mcp(key, "tools/list", {});
  const names = list.body.result?.tools?.map((t) => t.name);
  check(names?.length === 7, `staff tools/list: ${names?.join(", ")}`, list.body);
  const catalogueChars = JSON.stringify(list.body.result.tools).length;
  console.log(`     catalogue ~${Math.round(catalogueChars / 4)} tokens`);

  const unauth = await fetch(`${HOSTING}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  check(unauth.status === 401, "MCP without credentials: HTTP 401");

  let t = await call(key, "pioneers_whoami", {});
  check(!t.isError && t.data.roles?.includes("staff"), "whoami", t.data);
  t = await call(key, "pioneers_list", { object: "founders" });
  check(t.isError && /batchId/.test(t.data), "list founders without batchId is an oriented refusal", t.data);
  t = await call(key, "pioneers_get", { object: "founder", id: founder.id });
  check(!t.isError && t.data.id === founder.id, "get founder", t.data);
  t = await call(key, "pioneers_list", { object: "fields" });
  check(!t.isError && t.data.items.some((f) => f.dbField === "startupProfile.icp"), "list fields");

  // set_fields : apercu, confirmation, rejeu
  const startupId = founder.startupId;
  t = await call(key, "pioneers_set_fields", { subjects: { startupId }, values: { "startupProfile.icp": "E2E: B2B ops teams", "startup.vertical": "nonexistent-vertical" } });
  check(t.isError && /unknown value/.test(t.data), "closed-list value refused with accepted values", t.data);
  t = await call(key, "pioneers_set_fields", { subjects: { startupId }, values: { "startupProfile.icpp": "x" } });
  check(t.isError && /Closest/.test(t.data), "unknown field refused with closest addresses", t.data);
  t = await call(key, "pioneers_set_fields", { subjects: { startupId }, values: { "startupProfile.icp": "" } });
  check(t.isError, "empty value refused", t.data);
  const before = (await getFirestore().doc(`startups/${startupId}/private/profile`).get()).get("icp");
  t = await call(key, "pioneers_set_fields", { subjects: { startupId }, values: { "startupProfile.icp": "E2E: B2B ops teams" } });
  check(!t.isError && t.data.planId && t.data.applied === false, "preview returns a planId", t.data);
  const afterPreview = (await getFirestore().doc(`startups/${startupId}/private/profile`).get()).get("icp");
  check(afterPreview === before, "preview wrote nothing");
  const planId = t.data.planId;
  t = await call(key, "pioneers_set_fields", { planId, values: { "startupProfile.icp": "other" } });
  check(t.isError && /planId/.test(t.data), "planId plus values is refused", t.data);
  t = await call(key, "pioneers_set_fields", { planId });
  check(!t.isError && t.data.applied === true && t.data.replayed === false, "apply plan", t.data);
  const written = (await getFirestore().doc(`startups/${startupId}/private/profile`).get()).get("icp");
  check(written === "E2E: B2B ops teams", "value written");
  t = await call(key, "pioneers_set_fields", { planId });
  check(!t.isError && t.data.replayed === true, "replaying the plan has no effect", t.data);
  t = await call(key, "pioneers_set_fields", { subjects: { startupId }, values: { "startupProfile.icp": "E2E: B2B ops teams" } });
  check(!t.isError && t.data.nothingToWrite === true, "same value: nothing to write, no plan", t.data);

  // plan perime : la base change entre l'apercu et la confirmation
  t = await call(key, "pioneers_set_fields", { subjects: { startupId }, values: { "startupProfile.whyNow": "E2E why now" } });
  await getFirestore().doc(`startups/${startupId}/private/profile`).set({ whyNow: "changed meanwhile" }, { merge: true });
  t = await call(key, "pioneers_set_fields", { planId: t.data.planId });
  check(t.isError && /plan_stale/.test(t.data), "stale plan refused", t.data);

  // update du jeudi : document cree a la demande
  const monday = "2026-11-16";
  t = await call(key, "pioneers_set_fields", { subjects: { startupId, founderId: founder.id, weekStartDayString: "2026-11-17" }, values: { "checkin.totalAmountPaid": 1200 } });
  check(t.isError && /Monday/.test(t.data), "a non-Monday week is refused", t.data);
  t = await call(key, "pioneers_set_fields", { subjects: { startupId, founderId: founder.id, weekStartDayString: monday }, values: { "checkin.totalAmountPaid": 1200, "checkin.moral": 8 } });
  t = await call(key, "pioneers_set_fields", { planId: t.data.planId });
  const checkin = (await getFirestore().doc(`checkins/${startupId}_${monday}_${founder.id}`).get()).data();
  check(checkin?.totalAmountPaid === 1200 && checkin?.batchId === "fall-2026" && Array.isArray(checkin?.attachmentUrls), "checkin created with structure and defaults", checkin);

  // modele standard (SPECS §2) : une metrique d'equipe s'ecrit en champ imbrique ; avis, picks et notes du jury : formulaire seulement
  t = await call(key, "pioneers_set_fields", { subjects: { eventId: "demo-hackathon-1", teamId: "team-b" }, values: { "submission.metrics.callsMade": 7 } });
  t = await call(key, "pioneers_set_fields", { planId: t.data.planId });
  const teamB = (await getFirestore().doc("events/demo-hackathon-1/submissions/team-b").get()).data();
  check(teamB?.metrics?.callsMade === 7 && teamB.recordedSource === "staff" && Array.isArray(teamB.proofUrls), "a team metric is written nested, marked staff", teamB);
  t = await call(key, "pioneers_set_fields", { subjects: { eventId: "demo-hackathon-1", teamId: "team-b" }, values: { "submission.metrics.Calls-made": 7 } });
  check(t.isError && /unknown_field/.test(t.data), "a malformed metric key is refused", t.data);
  t = await call(key, "pioneers_set_fields", { subjects: { eventId: "demo-hackathon-2", founderId: founder.id }, values: { "picks.pickedFounderIds": ["chloe-demo"] } });
  check(t.isError && /form_only/.test(t.data), "picks are only written by their form", t.data);
  t = await call(key, "pioneers_list", { object: "fields" });
  check(!t.isError && !t.data.items.some((f) => /^(picks|peerRating|evaluation)\./.test(f.dbField)) && t.data.items.some((f) => f.dbField === "submission.metrics.<key>"), "fields list: families, no private documents", t.data.items?.length);

  // copies de `people` : WhatsApp vers le Profile Book, nom affiche vers la fiche fondateur
  t = await call(key, "pioneers_set_fields", {
    subjects: { personId: "person-ben-sample" },
    values: { "person.whatsapp": "+33 6 00 00 00 01", "person.firstName": "Benjamin" },
  });
  t = await call(key, "pioneers_set_fields", { planId: t.data.planId });
  const [benPerson, benDirectory, benFounder] = await Promise.all([
    getFirestore().doc("people/person-ben-sample").get(),
    getFirestore().doc("founders/ben-sample/private/directory").get(),
    getFirestore().doc("founders/ben-sample").get(),
  ]);
  check(
    benDirectory.get("whatsapp") === "+33 6 00 00 00 01" &&
      benPerson.get("displayName") === "Benjamin Sample" &&
      benFounder.get("name") === "Benjamin Sample",
    "person copies follow (directory WhatsApp, display name, founder name)",
    { directory: benDirectory.get("whatsapp"), displayName: benPerson.get("displayName"), founder: benFounder.get("name") },
  );

  // note
  t = await call(key, "pioneers_add_note", { targetType: "startup", targetId: startupId, body: "E2E meeting notes" });
  check(!t.isError && t.data.preview.note.source === "claude", "add_note preview (source claude)", t.data);
  t = await call(key, "pioneers_add_note", { planId: t.data.planId });
  check(!t.isError && t.data.result?.noteId, "add_note applied", t.data);

  t = await call(key, "pioneers_add_note", { targetType: "startup", targetId: startupId, body: "x", dayString: "2026-13-45" });
  check(t.isError && /dayString/.test(t.data), "an impossible day is refused on a note", t.data);

  // /v1 : dryRun et idempotence
  const body = JSON.stringify({ targetType: "founder", targetId: founder.id, body: "E2E via API" });
  const h = { "content-type": "application/json", authorization: `Bearer ${key}` };
  r = await fetch(`${HOSTING}/v1/notes?dryRun=true`, { method: "POST", headers: h, body });
  const dry = await r.json();
  check(r.status === 200 && dry.applied === false, "POST /v1/notes?dryRun=true", dry);
  r = await fetch(`${HOSTING}/v1/notes`, { method: "POST", headers: { ...h, "idempotency-key": "e2e-1" }, body });
  const first = await r.json();
  check(r.status === 201 && first.result?.noteId, "POST /v1/notes with Idempotency-Key", first);
  r = await fetch(`${HOSTING}/v1/notes`, { method: "POST", headers: { ...h, "idempotency-key": "e2e-1" }, body });
  const second = await r.json();
  check(r.status === 200 && second.replayed === true && second.result.noteId === first.result.noteId, "same key: replayed, no duplicate", second);
  r = await fetch(`${HOSTING}/v1/notes`, { method: "POST", headers: { ...h, "idempotency-key": "e2e-1" }, body: JSON.stringify({ targetType: "founder", targetId: founder.id, body: "different" }) });
  check(r.status === 409, "same key, different request: 409");
  r = await fetch(`${HOSTING}/v1/fields`, { method: "POST", headers: h, body: JSON.stringify({ subjects: { startupId }, values: { "startupProfile.icp": 5 } }) });
  const bad = await r.json();
  check(r.status === 400 && bad.error.field === "values.startupProfile.icp", "400 names the field", bad);

  // audit
  const audits = await getFirestore().collection("auditLogs").where("actorUid", "==", "staff-1").get();
  const vias = audits.docs.map((d) => d.get("via"));
  check(vias.includes("mcp") && vias.includes("api"), `audit logs written (${audits.size}: ${[...new Set(vias)].join(", ")})`);

  const emptyRevoke = await callable("revokeApiKey", staff, { keyId: "" });
  check(emptyRevoke.error?.status === "INVALID_ARGUMENT", "revokeApiKey with an empty keyId is a clear refusal", emptyRevoke);

  // OpenAPI : publique, tiree des contrats
  r = await fetch(`${HOSTING}/v1/openapi.json`);
  const spec = await r.json();
  check(
    r.status === 200 && spec.openapi === "3.1.0" && spec.paths["/v1/fields"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties?.values,
    "OpenAPI spec is public and generated from the contracts",
    Object.keys(spec.paths ?? {}),
  );

  // ---- Creer un evenement et un formulaire (staff) ----
  t = await call(key, "pioneers_create_event", { batchId: "fall-2026", name: "Office hour", startDateISOString: "2026-11-19T15:00:00+01:00" });
  check(!t.isError && t.data.preview.event.kind === "session" && t.data.preview.event.forms.length === 0 && !t.data.preview.event.matching, "a blank event: no matching, no forms", t.data);
  t = await call(key, "pioneers_create_event", { batchId: "fall-2026", name: "Office hour", startDateISOString: "2026-11-19T15:00:00+01:00", startupIds: ["nope"], kind: "meeting" });
  check(t.isError && /startup_not_found/.test(t.data), "create_event refuses an unknown startup", t.data);
  t = await call(key, "pioneers_create_event", {
    batchId: "fall-2026",
    kind: "meeting",
    name: "Office hour Lumen x Mia",
    startDateISOString: "2026-11-19T15:00:00+01:00",
    endDateISOString: "2026-11-19T15:45:00+01:00",
    startupIds: [startupId],
    mentorIds: ["mia-mentor"],
  });
  check(!t.isError && t.data.planId && t.data.preview.event.mentors?.[0] === "Mia Mentor", "create_event previews an office hour with its mentor", t.data);
  t = await call(key, "pioneers_create_event", { planId: t.data.planId });
  const eventId = t.data.result?.eventId;
  const createdEvent = eventId ? (await getFirestore().doc(`events/${eventId}`).get()).data() : null;
  check(
    createdEvent?.kind === "meeting" && createdEvent?.mentorIds?.includes("mia-mentor") && createdEvent?.startupIds?.includes(startupId) && createdEvent?.status === "scheduled" && createdEvent?.startDateISOString === "2026-11-19T14:00:00.000Z",
    "create_event writes the event (mentor, startup, UTC start)",
    createdEvent,
  );
  t = await call(key, "pioneers_create_event", { batchId: "fall-2026", templateKey: "pitch_day", name: "Pitch day 1", startDateISOString: "2026-11-27T14:00:00+01:00", status: "draft" });
  check(!t.isError && t.data.preview.event.scoringCriteria?.length > 0, "a model copies its scoring grid", t.data);
  // Un template est un pack : l'evenement, son matching et ses formulaires, nes comme lui.
  t = await call(key, "pioneers_create_event", { batchId: "fall-2026", templateKey: "hackathon", name: "Pack check", startDateISOString: "2026-11-30T09:30:00+01:00" });
  check(!t.isError && t.data.preview.event.matching === "teams of 3" && t.data.preview.event.forms.some((f) => /Submission \(open\)/.test(f)) && t.data.preview.event.forms.some((f) => /Peer rating \(open\)/.test(f)), "a hackathon pack previews its teams and forms", t.data);
  t = await call(key, "pioneers_create_event", { planId: t.data.planId });
  {
    const packId = t.data?.result?.eventId;
    const packEvent = packId ? (await getFirestore().doc(`events/${packId}`).get()).data() : null;
    const packForms = packId ? await getFirestore().collection("forms").where("eventId", "==", packId).get() : null;
    check(
      packEvent?.matching?.mode === "challenge" && packEvent.endDateISOString > packEvent.startDateISOString && packForms?.size >= 2 && packForms.docs.every((d) => d.get("status") === "open"),
      "the pack writes its matching and its published forms",
      { matching: packEvent?.matching, forms: packForms?.docs.map((d) => [d.get("kind"), d.get("status")]) },
    );
  }

  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", templateKey: "session_feedback" });
  check(t.isError && /eventId/.test(t.data), "a feedback model needs its event", t.data);
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", title: "x", questions: [{ type: "text", label: "Q", dbField: "founder.nope" }] });
  check(t.isError && /unknown_field/.test(t.data), "create_form refuses an unknown field", t.data);
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", title: "Anonymous", identityCheck: "anonymous", questions: [{ type: "long_text", label: "Intro", dbField: "founderDirectory.introduceYourself" }] });
  check(t.isError && /invalid_form/.test(t.data), "an anonymous form cannot write to a founder field (editor rule)", t.data);
  t = await call(key, "pioneers_create_form", {
    batchId: "fall-2026",
    title: "Masterclass feedback",
    eventId,
    publish: true,
    questions: [
      { type: "rating", label: "How useful was it?", required: true, scale: { min: 1, max: 5 } },
      { type: "long_text", label: "One thing you will apply" },
      { type: "single_choice", label: "Would you come again?", options: ["Yes", "No"] },
    ],
  });
  check(!t.isError && t.data.planId && t.data.preview.form.questions.length === 3, "create_form previews 3 questions", t.data);
  t = await call(key, "pioneers_create_form", { planId: t.data.planId });
  const newForm = t.data.result;
  const formDoc = newForm?.formId ? (await getFirestore().doc(`forms/${newForm.formId}`).get()).data() : null;
  const v1 = newForm?.formId ? await getFirestore().doc(`forms/${newForm.formId}/versions/1`).get() : null;
  check(formDoc?.status === "open" && formDoc?.version === 1 && formDoc?.opensDateISOString && v1?.exists && /\/forms\//.test(newForm.url ?? ""), "a published form is open, versioned and has its link", { newForm, formDoc });
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", templateKey: "debrief" });
  check(t.isError && /eventId/.test(t.data), "a debrief needs its event", t.data);
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", templateKey: "debrief", eventId: "demo-hackathon-1" });
  check(
    !t.isError && t.data.preview.form.identityCheck === "account" && t.data.preview.form.questions.every((q) => q.about === "team"),
    "a submission previews its team questions only",
    t.data,
  );
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", templateKey: "peer_rating", eventId: "demo-hackathon-1" });
  check(
    !t.isError && t.data.preview.form.identityCheck === "account" && t.data.preview.form.questions.some((q) => q.writesTo === "peerRating.rating" && q.about === "each_teammate"),
    "a peer rating previews its rating, for each teammate",
    t.data,
  );
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", templateKey: "weekly_update" });
  t = await call(key, "pioneers_create_form", { planId: t.data.planId });
  const draft = (await getFirestore().doc(`forms/${t.data.result?.formId}`).get()).data();
  check(draft?.status === "draft" && draft?.version === 0 && draft?.questions?.length > 0, "a model form is created as a draft by default", draft);

  // ---- Droits par role : chacun voit et ecrit ce que l'app lui permet ----
  const keyFor = async (uid) => (await callable("createApiKey", await idToken(uid), { name: `${uid} check` })).result?.key;
  const [adaKey, icKey, lpKey, strangerKey] = await Promise.all(["ada-1", "ic-1", "lp-1", "stranger-1"].map(keyFor));
  check(adaKey && icKey && lpKey && strangerKey, "every signed-in account can create an API key (founder, investors, no role)");
  const rest = async (k, path, init = {}) => {
    const res = await fetch(`${HOSTING}${path}`, { ...init, headers: { authorization: `Bearer ${k}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    return { status: res.status, body: await res.json() };
  };

  // Fondateur (ada, membre de lumen)
  const adaTools = (await mcp(adaKey, "tools/list", {})).body.result?.tools?.map((t) => t.name) ?? [];
  check(adaTools.includes("pioneers_set_fields") && !adaTools.includes("pioneers_add_note"), `founder catalogue: ${adaTools.join(", ")}`);
  let g = await rest(adaKey, "/v1/founders/ada-example");
  check(g.status === 200 && "profile" in g.body && !("internal" in g.body) && g.body.person, "founder sees own profile and person, not internal", Object.keys(g.body));
  g = await rest(adaKey, "/v1/founders/ben-sample");
  check(g.status === 200 && "directory" in g.body && !("profile" in g.body) && !("internal" in g.body) && !("person" in g.body), "founder sees a batchmate's Profile Book only", Object.keys(g.body));
  g = await rest(adaKey, "/v1/startups/lumen");
  check("profile" in g.body && !("internal" in g.body), "founder sees own startup's profile, not its internal assessment", Object.keys(g.body));
  g = await rest(adaKey, "/v1/notes?startupId=lumen");
  check(g.status === 403, "founder cannot read internal notes");
  t = await call(adaKey, "pioneers_add_note", { targetType: "startup", targetId: "lumen", body: "x" });
  check(t.isError && /unknown_tool/.test(t.data), "add_note does not exist for a founder", t.data);
  t = await call(adaKey, "pioneers_set_fields", { subjects: { founderId: "ada-example" }, values: { "founderDirectory.introduceYourself": "Hello from the API" } });
  check(!t.isError && t.data.planId, "founder previews a change to own profile", t.data);
  t = await call(adaKey, "pioneers_set_fields", { planId: t.data.planId });
  check(!t.isError && t.data.applied, "founder writes own profile");
  t = await call(adaKey, "pioneers_set_fields", { subjects: { founderId: "ben-sample" }, values: { "founderDirectory.introduceYourself": "x" } });
  check(t.isError && /not_allowed/.test(t.data), "founder cannot write another founder's profile", t.data);
  t = await call(adaKey, "pioneers_set_fields", { subjects: { startupId: "lumen" }, values: { "startupProfile.icp": "x" } });
  check(t.isError && /not_allowed/.test(t.data), "founder cannot write staff fields (startup profile)", t.data);
  t = await call(adaKey, "pioneers_set_fields", { subjects: { personId: "person-ada-example" }, values: { "person.phone": "+33 6 11 22 33 44" } });
  check(!t.isError && t.data.planId, "founder may change own phone", t.data);
  g = await rest(adaKey, "/v1/notes", { method: "POST", body: JSON.stringify({ targetType: "founder", targetId: "ada-example", body: "x" }) });
  check(g.status === 403, "founder cannot add a note through /v1");
  g = await rest(adaKey, "/v1/events", { method: "POST", body: JSON.stringify({ batchId: "fall-2026", kind: "meeting", name: "x", startDateISOString: "2026-11-19T15:00:00+01:00" }) });
  check(g.status === 403, "founder cannot create an event");
  check(!adaTools.includes("pioneers_create_event") && !adaTools.includes("pioneers_create_form"), "create tools do not exist for a founder");

  // Investor IC : tout en lecture, rien en ecriture
  const icTools = (await mcp(icKey, "tools/list", {})).body.result?.tools?.map((t) => t.name) ?? [];
  check(!icTools.includes("pioneers_set_fields") && !icTools.includes("pioneers_add_note"), `IC investor catalogue is read-only: ${icTools.join(", ")}`);
  g = await rest(icKey, "/v1/founders/ada-example");
  check("internal" in g.body && "profile" in g.body && "person" in g.body, "IC investor sees internal data", Object.keys(g.body));
  check((await rest(icKey, "/v1/notes?startupId=lumen")).status === 200, "IC investor reads internal notes");

  // Investor portfolio : annuaire et startups, ni notes ni donnees internes
  g = await rest(lpKey, "/v1/founders/ada-example");
  check("directory" in g.body && !("internal" in g.body) && !("profile" in g.body) && !("person" in g.body), "portfolio investor: directory only", Object.keys(g.body));
  check((await rest(lpKey, "/v1/notes?startupId=lumen")).status === 403, "portfolio investor cannot read notes");

  // Compte sans role : le public
  g = await rest(strangerKey, "/v1/founders/ada-example");
  check(g.status === 200 && !("directory" in g.body), "account without role: public card only", Object.keys(g.body));
  g = await rest(strangerKey, "/v1/startups/lumen");
  check(!("profile" in g.body), "account without role: no startup profile");

  const otherRevoke = await callable("revokeApiKey", await idToken("ada-1"), { keyId: created.result.keyId });
  check(otherRevoke.error?.status === "NOT_FOUND", "a founder cannot revoke someone else's key", otherRevoke);

  // ---- OAuth : le parcours du connecteur Claude ----
  r = await fetch(`${HOSTING}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  check(/resource_metadata=".*\/\.well-known\/oauth-protected-resource\/mcp"/.test(r.headers.get("www-authenticate") ?? ""), "401 points to the OAuth discovery");
  const prm = await (await fetch(`${HOSTING}/.well-known/oauth-protected-resource/mcp`)).json();
  check(prm.resource === `${prm.authorization_servers?.[0]}/mcp`, "protected resource metadata (RFC 9728)", prm);
  const asm = await (await fetch(`${HOSTING}/.well-known/oauth-authorization-server`)).json();
  check(asm.code_challenge_methods_supported?.includes("S256") && asm.registration_endpoint, "authorization server metadata (RFC 8414)", asm);

  r = await fetch(`${HOSTING}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }) });
  check(r.status === 400, "register refuses a non-http redirect");
  const redirectUri = "http://127.0.0.1:33418/callback";
  r = await fetch(`${HOSTING}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "Claude Code (check)" }) });
  const client = await r.json();
  check(r.status === 201 && client.client_id, "dynamic client registration (RFC 7591)", client);

  const { createHash, randomBytes } = await import("node:crypto");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = (extra = {}) => {
    const u = new URL(`${HOSTING}/oauth/authorize`);
    for (const [k, v] of Object.entries({ response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state: "st-1", resource: prm.resource, ...extra })) u.searchParams.set(k, v);
    return fetch(u, { redirect: "manual" });
  };
  r = await authorize({ redirect_uri: "https://evil.example/cb" });
  check(r.status === 400, "authorize never redirects to an unregistered redirect_uri");
  r = await authorize({ code_challenge_method: "plain" });
  check(r.status === 302 && /error=invalid_request/.test(r.headers.get("location")), "authorize requires PKCE S256");
  r = await authorize();
  const consentUrl = new URL(r.headers.get("location") ?? "http://x/");
  const requestId = consentUrl.searchParams.get("request");
  check(r.status === 302 && consentUrl.pathname === "/oauth/consent" && requestId, "authorize sends to the consent page", r.headers.get("location"));

  const icDescribe = await callable("oauthDescribeRequest", icToken, { requestId });
  check(icDescribe.result?.canApprove === true, "consent: any signed-in account can connect Claude (with its own rights)", icDescribe);
  const described = await callable("oauthDescribeRequest", staff, { requestId });
  check(described.result?.clientName === "Claude Code (check)" && described.result?.redirectHost === "127.0.0.1:33418", "consent describes the client", described);
  const decided = await callable("oauthDecide", staff, { requestId, approve: true });
  const back = new URL(decided.result?.redirectUrl ?? "http://x/");
  const code = back.searchParams.get("code");
  check(code && back.searchParams.get("state") === "st-1" && back.origin + back.pathname === redirectUri, "staff approval returns code and state", decided);
  const again = await callable("oauthDecide", staff, { requestId, approve: true });
  check(again.error?.status === "FAILED_PRECONDITION", "a request is answered once", again);

  const token = (params) => fetch(`${HOSTING}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  r = await token({ grant_type: "authorization_code", code, code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier", client_id: client.client_id, redirect_uri: redirectUri });
  check(r.status === 400 && (await r.json()).error === "invalid_grant", "token: wrong PKCE verifier refused");
  r = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: redirectUri });
  const tokens = await r.json();
  check(r.status === 200 && tokens.access_token?.startsWith("pha_") && tokens.refresh_token?.startsWith("phr_"), "token: code exchanged with PKCE", tokens);

  const oauthList = await mcp(tokens.access_token, "tools/list", {});
  check(oauthList.status === 200 && oauthList.body.result?.tools?.length === 7, "MCP works with the OAuth access token", oauthList.body);
  r = await fetch(`${HOSTING}/v1/me`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  check(r.status === 401, "an OAuth token is refused on /v1 (audience is /mcp)");

  r = await token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
  const rotated = await r.json();
  check(r.status === 200 && rotated.refresh_token !== tokens.refresh_token, "refresh rotates the refresh token", rotated);
  check((await mcp(rotated.access_token, "tools/list", {})).status === 200, "the new access token works");
  r = await token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
  check(r.status === 400, "reusing an old refresh token is refused");
  check((await mcp(rotated.access_token, "tools/list", {})).status === 401, "...and revokes the whole authorization");
  r = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: redirectUri });
  check(r.status === 400, "an authorization code works once");

  // revocation
  await callable("revokeApiKey", staff, { keyId: created.result.keyId });
  r = await fetch(`${HOSTING}/v1/me`, { headers: { authorization: `Bearer ${key}` } });
  check(r.status === 401, "revoked key refused");

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL GREEN");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
