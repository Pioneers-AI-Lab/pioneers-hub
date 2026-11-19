// ----------------------------
// Verification de l API (/v1) et du serveur MCP, de bout en bout (emulateurs + seed)
// ----------------------------
// npm run check:api  (emulateurs decales de +200, seed, puis ce script)
//
// Passe par la reecriture Hosting, comme en production : https://pioneers-hub-api.web.app.
// Code de sortie 1 au premier ecart.
import { createServer } from "node:http";
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
  check(names?.length === 9, `staff tools/list: ${names?.join(", ")}`, list.body);
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
  // La grille Pitch (17/11, famille Team en trois criteres le 18/11) : dix criteres de 0 a 5 dont les points font 100, sur le bareme et sur le jury.
  t = await call(key, "pioneers_create_event", { planId: t.data.planId });
  {
    const pitchId = t.data?.result?.eventId;
    const pitchEvent = pitchId ? (await getFirestore().doc(`events/${pitchId}`).get()).data() : null;
    const jury = pitchId ? (await getFirestore().doc(`forms/${pitchId}-jury`).get()).data() : null;
    const criteria = (jury?.questions ?? []).filter((q) => q.id.startsWith("criterion_"));
    const points = (pitchEvent?.scoring?.items ?? []).map((i) => i.maxPoints ?? 0);
    check(
      points.length === 10 && points.reduce((a, b) => a + b, 0) === 100 && criteria.length === 10 && criteria.reduce((a, q) => a + q.weight, 0) === 100 && criteria.every((q) => q.scale?.min === 0 && q.scale?.max === 5),
      "the Pitch pack: 10 criteria from 0 to 5, points summing to 100 (scoring and jury)",
      { points, criteria: criteria.map((q) => [q.id, q.weight, q.scale]) },
    );
  }
  // Un modele d'evenement retire (decision du 17/11) ne se cree plus et ne s'applique plus.
  t = await call(key, "pioneers_create_event", { batchId: "fall-2026", templateKey: "vibethon", name: "Retired", startDateISOString: "2026-11-30T09:30:00+01:00" });
  check(t.isError && /templateKey/.test(t.data), "create_event refuses a retired event model (vibethon)", t.data);
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

  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", templateKey: "week_retro" });
  check(t.isError && /eventId/.test(t.data), "an event's model needs its event", t.data);
  // Un modele retire (decision du 17/11) ne se cree plus, ni par l'API ni par le MCP.
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", templateKey: "picks", eventId: "demo-hackathon-2" });
  check(t.isError && /templateKey/.test(t.data), "a retired model (picks) is refused", t.data);
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", title: "x", questions: [{ type: "text", label: "Q", dbField: "founder.nope" }] });
  check(t.isError && /unknown_field/.test(t.data), "create_form refuses an unknown field", t.data);
  // Plus de formulaire anonyme ni de question Picks (17/11, §4.6) : les anciens restent lus.
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", title: "Anonymous", identityCheck: "anonymous", questions: [{ type: "long_text", label: "Q" }] });
  check(t.isError && /identityCheck/.test(t.data), "an anonymous form is no longer created", t.data);
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", title: "x", eventId: "demo-hackathon-2", questions: [{ type: "entity_picker", label: "Q", picker: { entity: "founder", maxItems: 3 }, dbField: "picks.pickedFounderIds" }] });
  check(t.isError && /invalid_form/.test(t.data) && /retired/.test(t.data), "a new question cannot write the retired picks", t.data);
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
    !t.isError && t.data.preview.form.identityCheck === "account" && ["peerRating.likability", "peerRating.reliability"].every((f) => t.data.preview.form.questions.some((q) => q.writesTo === f && q.about === "each_teammate")),
    "a peer rating previews its two scores, for each teammate",
    t.data,
  );
  // L'ancien « Thursday update » est retire (le Weekly update startup le remplace, sur l'agenda).
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", templateKey: "weekly_update" });
  check(t.isError && /templateKey/.test(t.data), "the retired Thursday update model is refused", t.data);
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", title: "Pick name", identityCheck: "select_name", questions: [{ type: "long_text", label: "Q" }] });
  check(t.isError && /identityCheck/.test(t.data), "a pick-name form is no longer created", t.data);
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", title: "Default identity", questions: [{ type: "long_text", label: "Q" }] });
  check(!t.isError && t.data.preview.form.identityCheck === "account", "a form without model is answered from the account by default", t.data);
  t = await call(key, "pioneers_create_form", { batchId: "fall-2026", templateKey: "lock_my_team" });
  t = await call(key, "pioneers_create_form", { planId: t.data.planId });
  const draft = (await getFirestore().doc(`forms/${t.data.result?.formId}`).get()).data();
  check(draft?.status === "draft" && draft?.version === 0 && draft?.questions?.length > 0, "a model form is created as a draft by default", draft);

  // ---- Les actions de l'Admin (`pioneers_run`, POST /v1/actions/{action}) ----
  const db = getFirestore();
  const run = async (action, args) => {
    const preview = await call(key, "pioneers_run", { action, args });
    if (preview.isError || !preview.data.planId) return { preview, applied: null };
    return { preview, applied: await call(key, "pioneers_run", { planId: preview.data.planId }) };
  };
  t = await call(key, "pioneers_list", { object: "actions" });
  const actionNames = t.data?.items?.map((a) => a.action) ?? [];
  check(actionNames.length >= 40 && actionNames.includes("draw_teams") && t.data.items.every((a) => a.description && !a.args), `list actions: ${actionNames.length}, short`, t.data);
  t = await call(key, "pioneers_list", { object: "actions", search: "draw_teams" });
  check(t.data?.items?.length === 1 && t.data.items[0].args?.properties?.seed, "list actions with search: that action's arguments", t.data);
  t = await call(key, "pioneers_guide", {});
  check(!t.isError && t.data.topics?.some((x) => x.topic === "scores"), "guide lists its topics", t.data);
  t = await call(key, "pioneers_guide", { topic: "events" });
  check(!t.isError && /matching/.test(t.data.body), "guide returns a topic", t.data);
  t = await call(key, "pioneers_run", { action: "update_event", args: { eventId, nope: 1 } });
  check(t.isError && /nope|invalid_request/.test(t.data), "an action refuses an unknown argument", t.data);
  t = await call(key, "pioneers_run", { action: "apply_event_template", args: { eventId, templateKey: "edge_drill" } });
  check(t.isError && /templateKey/.test(t.data), "apply_event_template refuses a retired event model (edge_drill)", t.data);

  // Evenement : regler, deplacer avec ses formulaires, archiver / restaurer
  let a = await run("update_event", { eventId, location: "Room 2", audience: "guests" });
  check(a.preview.data?.preview?.changes?.location?.to === "Room 2" && a.applied && !a.applied.isError, "update_event previews then applies the change", a);
  let ev = (await db.doc(`events/${eventId}`).get()).data();
  check(ev?.location === "Room 2" && ev?.audience === "guests", "update_event writes the event", ev);
  const audit = await db.collection("auditLogs").where("action", "==", "update_event").get();
  check(audit.docs.some((d) => d.get("via") === "mcp"), "an action is audited with its channel");
  const pack = (await db.collection("events").where("name", "==", "Pack check").get()).docs[0];
  const packForms = await db.collection("forms").where("eventId", "==", pack.id).get();
  const opensBefore = packForms.docs.map((d) => d.get("opensDateISOString"));
  const dayLater = (iso) => new Date(Date.parse(iso) + 86400000).toISOString();
  a = await run("update_event", { eventId: pack.id, startDateISOString: dayLater(pack.get("startDateISOString")), endDateISOString: dayLater(pack.get("endDateISOString")) });
  check(a.preview.data?.preview?.movedForms?.length > 0, "moving an event previews its forms' new dates", a.preview.data);
  const opensAfter = (await db.collection("forms").where("eventId", "==", pack.id).get()).docs.map((d) => d.get("opensDateISOString"));
  check(opensAfter.some((o, i) => o && o !== opensBefore[i]), "moving an event moves its forms", { opensBefore, opensAfter });
  a = await run("archive_event", { eventId: pack.id, archived: true });
  const closed = (await db.collection("forms").where("eventId", "==", pack.id).get()).docs.map((d) => d.get("status"));
  check(a.applied && closed.every((s) => s !== "open") && (await db.doc(`events/${pack.id}`).get()).get("archivedDateISOString"), "archive_event hides the event and closes its forms", closed);
  a = await run("archive_event", { eventId: pack.id, archived: false });
  const reopened = (await db.collection("forms").where("eventId", "==", pack.id).get()).docs.map((d) => d.get("status"));
  check(reopened.some((s) => s === "open"), "restoring the event reopens its forms", reopened);

  // Formulaire : nouvelle version, statut, copie, archivage
  const published = (await db.doc(`forms/${newForm.formId}`).get()).data();
  a = await run("update_form", {
    formId: newForm.formId,
    questions: [{ id: published.questions[0].id, label: "How useful was the session?" }, { id: published.questions[1].id }, { type: "text", label: "Anything else?" }],
  });
  check(/new version 2/.test(a.preview.data?.preview?.version ?? ""), "editing a published form's questions previews a new version", a.preview.data);
  const v2 = (await db.doc(`forms/${newForm.formId}`).get()).data();
  check(
    v2?.version === 2 && (await db.doc(`forms/${newForm.formId}/versions/2`).get()).exists && v2.questions[0].label === "How useful was the session?" && v2.questions.some((q) => q.archived && q.type === "single_choice"),
    "update_form writes version 2, a left-out question is archived",
    v2?.questions,
  );
  a = await run("set_form_status", { formId: newForm.formId, status: "closed" });
  check((await db.doc(`forms/${newForm.formId}`).get()).get("status") === "closed", "set_form_status closes a form", a);
  const draftId = (await db.collection("forms").where("kind", "==", draft.kind).where("status", "==", "draft").get()).docs[0]?.id;
  a = await run("set_form_status", { formId: draftId, status: "open" });
  const opened = (await db.doc(`forms/${draftId}`).get()).data();
  check(opened?.status === "open" && opened.version === 1 && (await db.doc(`forms/${draftId}/versions/1`).get()).exists && /\/forms\//.test(a.applied?.data?.result?.url ?? ""), "opening a draft publishes it (version 1, link)", a.applied?.data);
  a = await run("duplicate_form", { formId: draftId });
  const copyId = a.applied?.data?.result?.formId;
  const copy = copyId ? (await db.doc(`forms/${copyId}`).get()).data() : null;
  check(copy?.status === "draft" && copy.version === 0, "duplicate_form makes a draft copy", copy);
  // Une copie est un nouveau formulaire : rien de ce qui est retire le 17/11 (Picks, anonyme, nom choisi) ne s'y recopie.
  {
    const base = (await db.doc("forms/demo-weekly-form").get()).data();
    await db.doc("forms/check-anonymous-form").set({ ...base, title: "Old anonymous", identityCheck: "anonymous" });
    await db.doc("forms/check-picks-form").set({ ...base, title: "Old picks", kind: "picks", identityCheck: "account" });
    for (const [formId, label] of [["demo-weekly-form", "pick-name"], ["check-anonymous-form", "anonymous"], ["check-picks-form", "picks"]]) {
      a = await run("duplicate_form", { formId });
      check(a.preview.isError && /invalid_form/.test(a.preview.data) && /retired/.test(a.preview.data), `duplicate_form refuses to copy a ${label} form`, a.preview.data);
    }
  }
  a = await run("archive_form", { formId: copyId, archived: true });
  check((await db.doc(`forms/${copyId}`).get()).get("archivedDateISOString"), "archive_form archives", a);
  t = await call(key, "pioneers_list", { object: "forms", batchId: "fall-2026", eventId: pack.id });
  check(!t.isError && t.data.items.length === packForms.size, "list forms of an event", t.data);
  t = await call(key, "pioneers_get", { object: "form", id: newForm.formId });
  check(!t.isError && t.data.questions?.length >= 3 && t.data.url, "get form returns its questions and link", t.data);
  t = await call(key, "pioneers_get", { object: "event", id: pack.id });
  check(!t.isError && t.data.forms?.length === packForms.size, "get event returns its forms", t.data?.forms);
  // Lock my team, la revue des Weekly updates et l'historique des shortlists : staff dans l'app, jamais par l'API (SPECS §6.2).
  {
    const scoped = { programId: "accelerator", batchId: "fall-2026" };
    await Promise.all([
      db.doc(`teamLocks/${founder.id}`).set({ ...scoped, founderId: founder.id, locked: true, coFounderIds: [], startupName: "Secret lock", updatedDateISOString: new Date().toISOString() }),
      db.doc(`founderReviews/${founder.id}_2026-11-30`).set({ ...scoped, founderId: founder.id, weekStartDayString: "2026-11-30", goalAmbitious: true, goalReached: null, problemValidated: null }),
      db.doc(`shortlistHistory/${founder.id}_x`).set({ ...scoped, founderId: founder.id, targetFounderId: "x", firstShortlistedDateISOString: new Date().toISOString() }),
    ]);
    // Staff : la reponse a Lock my team et les revues, par l'API aussi ; jamais l'historique des shortlists.
    t = await call(key, "pioneers_get", { object: "founder", id: founder.id });
    const text = JSON.stringify(t.data);
    check(!t.isError && t.data.teamLock?.startupName === "Secret lock" && t.data.weeklyReviews?.some((r) => r.goalAmbitious === true), "staff: get founder returns the team lock and weekly reviews", text.slice(0, 300));
    check(!/shortlistHistory|firstShortlisted/.test(text), "get founder never returns the shortlist history", text.slice(0, 300));
    for (const object of ["teamLocks", "founderReviews", "startupReviews", "shortlistHistory"]) {
      t = await call(key, "pioneers_list", { object, batchId: "fall-2026" });
      check(t.isError, `list refuses \`${object}\``, t.data);
    }
  }

  // Taches du To do
  a = await run("create_task", { batchId: "fall-2026", title: "Book your office hour", linkUrl: "calendly.com/pioneers" });
  const taskId = a.applied?.data?.result?.taskId;
  const task = taskId ? (await db.doc(`batchTasks/${taskId}`).get()).data() : null;
  check(task?.linkUrl === "https://calendly.com/pioneers" && task.archivedDateISOString === null, "create_task completes the link and appends", task);
  a = await run("move_task", { taskId, position: 1 });
  t = await call(key, "pioneers_list", { object: "tasks", batchId: "fall-2026" });
  check(t.data?.items?.[0]?.id === taskId, "move_task puts it first", t.data?.items?.map((x) => x.title));
  a = await run("update_task", { taskId, title: "Book an office hour" });
  const opens = "2030-01-02T09:00:00.000Z";
  a = await run("update_task", { taskId, opensDateISOString: opens, deadlineDateISOString: "2030-01-01T09:00:00.000Z" });
  check(!a.applied, "update_task refuses a deadline before the opening", a);
  a = await run("update_task", { taskId, opensDateISOString: opens, deadlineDateISOString: "2030-01-03T09:00:00.000Z", check: "shortlist" });
  t = await call(key, "pioneers_list", { object: "tasks", batchId: "fall-2026" });
  const listed = t.data?.items?.find((x) => x.id === taskId);
  check(listed?.opensDateISOString === opens && listed.check === "shortlist", "update_task sets the dates and the check", listed);
  a = await run("archive_task", { taskId, archived: true });
  check((await db.doc(`batchTasks/${taskId}`).get()).get("archivedDateISOString"), "archive_task archives", a);

  // Presence : le premier geste enregistre tous les attendus
  const roster = (await db.collection("founders").where("batchId", "==", "fall-2026").get()).docs.filter((d) => !d.get("archivedDateISOString"));
  a = await run("update_event", { eventId, audience: "batch" });
  a = await run("mark_attendance", { eventId, marks: [{ founderId: "ada-example", status: "absent" }] });
  const marks = await db.collection(`events/${eventId}/attendance`).get();
  check(a.applied && marks.docs.find((d) => d.id === "ada-example")?.get("status") === "absent" && marks.size > 1, `mark_attendance records ${marks.size} founders`, a.preview.data);
  t = await call(key, "pioneers_run", { action: "mark_attendance", args: { eventId, marks: [{ founderId: "nobody", status: "absent" }] } });
  check(t.isError && /not_expected/.test(t.data), "mark_attendance refuses a founder not expected", t.data);
  void roster;

  // Programmes, batchs, listes
  a = await run("create_program", { name: "Studio Check" });
  check(a.applied?.data?.result?.programId === "studio-check", "create_program slugs its id", a.applied?.data);
  a = await run("create_batch", { programId: "studio-check", name: "Spring 2028", startDayString: "2028-03-01", endDayString: "2028-05-30" });
  check((await db.doc("batches/spring-2028").get()).get("status") === "upcoming", "create_batch creates an upcoming batch", a.applied?.data);
  a = await run("update_batch", { batchId: "spring-2028", milestones: [{ key: "demo_day", dayString: "2028-05-28" }], leaderboardVisibility: "hidden" });
  const b = (await db.doc("batches/spring-2028").get()).data();
  check(b?.milestones.find((m) => m.key === "demo_day")?.dayString === "2028-05-28" && b.settings.leaderboardVisibility === "hidden" && b.milestones.length === 5, "update_batch sets a milestone and a setting", b);
  a = await run("update_batch", { batchId: "spring-2028", subScoreVisibility: { founder: { edge: "staff", commitment: "none" } } });
  a = await run("update_batch", { batchId: "spring-2028", subScoreVisibility: { founder: { commitment: null }, startup: { market: "founders" } } });
  // Ecrit en entier (null : suit les scores), pour qu'une ecriture en merge retire bien un reglage.
  const subScores = (await db.doc("batches/spring-2028").get()).data()?.settings.subScoreVisibility;
  const set = (own) => Object.fromEntries(Object.entries(own ?? {}).filter(([, a]) => a !== null));
  check(
    JSON.stringify({ founder: set(subScores?.founder), startup: set(subScores?.startup) }) === JSON.stringify({ founder: { edge: "staff" }, startup: { market: "founders" } }) &&
      subScores?.founder?.commitment === null,
    "update_batch sets each sub-score's audience, null goes back to the scores setting",
    subScores,
  );
  a = await run("add_list_values", { list: "industries", values: ["Quantum check"] });
  check(a.applied?.data?.result?.added?.[0] === "Quantum check", "add_list_values adds a new value", a.applied?.data);
  t = await call(key, "pioneers_run", { action: "add_list_values", args: { list: "industries", values: ["quantum CHECK"] } });
  check(t.data?.nothingToWrite === true, "a known value (any case) is not added twice", t.data);

  // Rattachement : lier, refuser l'archivage, delier
  a = await run("link_founder", { founderId: "chloe-demo", email: "stranger@pioneers.test" });
  check(a.applied && (await db.doc("batchMemberships/fall-2026_stranger-1").get()).exists && (await db.doc("founders/chloe-demo").get()).get("uid") === "stranger-1", "link_founder links profile and account", a.applied?.data);
  t = await call(key, "pioneers_run", { action: "archive_founder", args: { founderId: "chloe-demo", archived: true } });
  check(t.isError && /linked/.test(t.data), "a linked profile is not archived", t.data);
  a = await run("unlink_founder", { founderId: "chloe-demo" });
  check(!(await db.doc("batchMemberships/fall-2026_stranger-1").get()).exists && (await db.doc("founders/chloe-demo").get()).get("uid") === null, "unlink_founder frees profile and access", a.applied?.data);

  // Comptes : jamais le role staff
  t = await call(key, "pioneers_run", { action: "set_account_access", args: { uid: "staff-1", roles: [] } });
  check(t.isError && /staff_account/.test(t.data), "a staff account's access is not changed through the API", t.data);
  t = await call(key, "pioneers_run", { action: "set_account_access", args: { uid: "lp-1", roles: ["staff"] } });
  check(t.isError, "the staff role cannot be given through the API", t.data);
  a = await run("set_account_access", { uid: "lp-1", roles: ["investor"], investorAccess: "ic" });
  check(a.applied && !a.applied.isError && (await db.doc("users/lp-1").get()).get("investorAccess") === "ic", "set_account_access (an effect outside the transaction) applies", a.applied?.data);
  a = await run("set_account_access", { uid: "lp-1", roles: ["investor"], investorAccess: "portfolio" });
  a = await run("invite_account", { email: "new.investor@pioneers.test", roles: ["investor"], investorAccess: "portfolio" });
  check(a.applied?.data?.result?.created === true, "invite_account creates the account", a.applied?.data);
  a = await run("create_set_password_link", { email: "new.investor@pioneers.test" });
  check(/^https?:\/\//.test(a.applied?.data?.result?.link ?? ""), "create_set_password_link gives the link of an invited account", a.applied?.data);
  t = await call(key, "pioneers_run", { action: "create_set_password_link", args: { uid: "staff-1" } });
  check(t.isError && /staff_account/.test(t.data), "create_set_password_link refuses a staff account", t.data);
  a = await run("set_account_disabled", { uid: "stranger-1", disabled: true });
  check((await getAuth().getUser("stranger-1")).disabled === true, "set_account_disabled blocks sign-in", a.applied?.data);
  t = await call(key, "pioneers_run", { planId: a.preview.data.planId });
  check(t.data?.replayed === true, "a confirmed effect replays without running twice", t.data);
  await run("set_account_disabled", { uid: "stranger-1", disabled: false });
  t = await call(key, "pioneers_list", { object: "accounts", search: "stranger" });
  check(t.data?.items?.length === 1 && t.data.items[0].disabled === false, "list accounts (staff)", t.data);
  a = await run("recompute_scores", { batchId: "fall-2026" });
  check(a.applied && !a.applied.isError && a.applied.data.result?.batchId === "fall-2026", "recompute_scores runs", a.applied?.data);
  t = await call(key, "pioneers_run", { action: "sync_calendar", args: { batchId: "spring-2028" } });
  check(t.isError && /no_calendar/.test(t.data), "sync_calendar needs a linked calendar", t.data);
  t = await call(key, "pioneers_list", { object: "mentors", search: "mia" });
  check(t.data?.items?.[0]?.id === "mia-mentor" && t.data.items[0].name === "Mia Mentor", "list mentors with their names", t.data);

  // REST
  r = await fetch(`${HOSTING}/v1/actions/archive_task?dryRun=true`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ taskId, archived: false }) });
  let rb = await r.json();
  check(r.status === 200 && rb.applied === false && rb.preview?.archived === false, "POST /v1/actions/{action}?dryRun=true previews", rb);
  r = await fetch(`${HOSTING}/v1/actions/constructor`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: "{}" });
  check(r.status === 404, "an unknown action is a 404");
  r = await fetch(`${HOSTING}/v1/actions`, { headers: { authorization: `Bearer ${key}` } });
  rb = await r.json();
  check(r.status === 200 && rb.items?.length === actionNames.length, "GET /v1/actions lists them", rb);
  t = await call(key, "pioneers_run", { planId: (await call(key, "pioneers_add_note", { targetType: "founder", targetId: "ada-example", body: "x", dayString: "2026-11-17" })).data?.planId });
  check(t.isError, "pioneers_run refuses another tool's plan", t.data);

  // ---- Phase 2 : matching, resultats, jury, classement, reponses, revues ----
  // Un hackathon neuf (pack : matching en equipes et ses formulaires).
  t = await call(key, "pioneers_create_event", { batchId: "fall-2026", templateKey: "hackathon", name: "Draw check", startDateISOString: "2026-12-01T09:30:00+01:00" });
  t = await call(key, "pioneers_create_event", { planId: t.data.planId });
  const drawEventId = t.data?.result?.eventId;
  a = await run("draw_teams", { eventId: drawEventId, groupSize: 2, keepApart: [["ada-example", "ben-sample"]], seed: 7 });
  const drawn = a.preview.data?.preview?.groups ?? [];
  check(drawn.length >= 2 && drawn.every((g) => g.leader) && a.applied && !a.applied.isError, `draw_teams drafts ${drawn.length} groups with leaders`, a.preview.data);
  const draftTeams = (await db.collection(`events/${drawEventId}/teams`).get()).docs;
  check(draftTeams.length === drawn.length && draftTeams.every((d) => d.get("publishedDateISOString") === null) && draftTeams[0].get("drawConstraints")?.keepApart?.length === 1, "the draw is saved as a draft with its constraints");
  check(!draftTeams.some((d) => d.get("memberIds").includes("ada-example") && d.get("memberIds").includes("ben-sample")), "keepApart is respected");
  t = await call(key, "pioneers_run", { action: "draw_teams", args: { eventId: drawEventId, groupSize: 2, seed: 7 } });
  check(JSON.stringify(t.data?.preview?.groups) === JSON.stringify(drawn), "the same seed gives the same draw", t.data);
  a = await run("publish_teams", { eventId: drawEventId });
  const pubTeams = (await db.collection(`events/${drawEventId}/teams`).get()).docs;
  const pubMemberships = await db.collection("memberships").where("eventId", "==", drawEventId).get();
  check(pubTeams.every((d) => d.get("publishedDateISOString")) && pubMemberships.size === pubTeams.reduce((n, d) => n + d.get("memberIds").length, 0) && pubTeams[0].get("memberNames")?.length, "publish_teams publishes, names and records memberships");
  t = await call(key, "pioneers_run", { action: "draw_teams", args: { eventId: drawEventId } });
  check(t.isError && /published/.test(t.data), "a published draw is not drawn again", t.data);
  const [t1, t2] = pubTeams.map((d) => ({ id: d.id, memberIds: d.get("memberIds") }));
  const moved = t2.memberIds[0];
  const editArgs = { eventId: drawEventId, teams: [{ id: t1.id, memberIds: [...t1.memberIds, moved] }, { id: t2.id, memberIds: t2.memberIds.slice(1) }, ...pubTeams.slice(2).map((d) => ({ id: d.id, memberIds: d.get("memberIds") }))] };
  a = await run("edit_teams", editArgs);
  const after1 = (await db.doc(`events/${drawEventId}/teams/${t1.id}`).get()).get("memberIds");
  const movedShip = (await db.collection("memberships").where("eventId", "==", drawEventId).where("founderId", "==", moved).get()).docs.map((d) => d.get("teamId"));
  check(a.applied && after1.includes(moved) && movedShip.length === 1 && movedShip[0] === t1.id, "edit_teams moves a founder; the membership follows", { after1, movedShip });
  t = await call(key, "pioneers_run", { action: "edit_teams", args: { eventId: drawEventId, teams: [{ id: t1.id, memberIds: ["ada-example"] }, { id: t2.id, memberIds: ["ada-example"] }] } });
  check(t.isError && /duplicate_member/.test(t.data), "edit_teams refuses a founder in two groups", t.data);
  a = await run("set_matching", { eventId: "demo-masterclass", mode: "matching", size: 4 });
  check((await db.doc("events/demo-masterclass").get()).get("matching")?.mode === "matching", "set_matching gives an event tables", a.applied?.data);
  a = await run("set_matching", { eventId: "demo-masterclass", mode: null });

  // Resultats d'une equipe publiee (hackathon 1)
  a = await run("set_team_results", { eventId: "demo-hackathon-1", teamId: "team-a", metrics: { callsMade: 12 }, proofUrls: ["drive.google.com/x"] });
  const subA = (await db.doc("events/demo-hackathon-1/submissions/team-a").get()).data();
  check(subA?.metrics?.callsMade === 12 && subA.recordedSource === "staff" && subA.proofUrls[0] === "https://drive.google.com/x" && !("id" in subA), "set_team_results writes a staff correction", subA);
  t = await call(key, "pioneers_run", { action: "set_outstanding", args: { eventId: "demo-hackathon-1", teamId: "team-a", outstanding: true } });
  check(t.isError && /not_eligible/.test(t.data), "the Outstanding mention needs the grid's maximum", t.data);

  // Le leaderboard suit ses cibles, quel que soit l'ecrivain (MCP, REST, ecran Admin = ecriture directe) :
  // equipes publiees (onTeamWritten), startups (onStartupUpdated), cibles de l'evenement (onEventUpdated).
  // La ligne d'une cible une fois que `test` l'accepte (5 s au plus), sinon la derniere lue.
  const rowWhen = async (eventId, targetId, test) => {
    let row;
    for (let i = 0; i < 20; i++) {
      row = (await db.doc(`leaderboards/${eventId}`).get()).get("rows")?.find((x) => x.targetId === targetId);
      if (test(row)) return { ok: true, row };
      await new Promise((ok) => setTimeout(ok, 250));
    }
    return { ok: false, row };
  };
  const judgeScore = (eventId, targetType, targetId, scores) =>
    db.doc(`events/${eventId}/evaluations/check-${targetId}`).set({ evaluatorKind: "judge", evaluatorId: "check", evaluatorName: "Check", isExternal: true, targetType, targetId, scores, updatedDateISOString: new Date().toISOString() });
  const hackTeams = (await db.collection(`events/${drawEventId}/teams`).get()).docs.map((d) => ({ id: d.id, memberIds: d.get("memberIds") }));
  const teamA = hackTeams.find((x) => x.memberIds.length >= 2);
  const [kept, removed] = teamA.memberIds;
  const removedName = (await db.doc(`founders/${removed}`).get()).get("name");
  const membersAre = (ids) => (row) => JSON.stringify([...(row?.memberIds ?? [])].sort()) === JSON.stringify([...ids].sort());
  const teamRowIs = (ids) => rowWhen(drawEventId, teamA.id, membersAre(ids));
  const withA = (memberIds) => ({ eventId: drawEventId, teams: hackTeams.map((x) => (x.id === teamA.id ? { id: x.id, memberIds } : x)) });
  await judgeScore(drawEventId, "team", teamA.id, { outputQuality: 4 });
  let w = await teamRowIs(teamA.memberIds);
  check(w.ok, "a scored team enters the leaderboard", w.row);
  a = await run("edit_teams", withA([kept]));
  const beforeA = a.preview.data?.preview?.before?.find((g) => g.id === teamA.id)?.members ?? [];
  check(!beforeA.includes(removed) && beforeA.some((n) => n && removedName.startsWith(n.split(" ")[0])), "edit_teams preview names a removed member", beforeA);
  w = await teamRowIs([kept]);
  check(w.ok, "MCP edit_teams: the leaderboard row follows", w.row);
  r = await fetch(`${HOSTING}/v1/actions/edit_teams`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(withA(teamA.memberIds)) });
  rb = await r.json();
  w = await teamRowIs(teamA.memberIds);
  check(rb.applied === true && w.ok, "REST edit_teams: the leaderboard row follows", { status: r.status, row: w.row });
  await db.doc(`events/${drawEventId}/teams/${teamA.id}`).update({ memberIds: [kept] });
  w = await teamRowIs([kept]);
  check(w.ok, "a direct write (Admin screen): the leaderboard row follows", w.row);
  await db.doc(`events/${drawEventId}/teams/${teamA.id}`).update({ memberIds: teamA.memberIds });

  // La presence masque un absent de son groupe publie, partout, et le rend s'il revient (onAttendanceWritten, 19/11)
  const docWhen = async (path, test) => {
    let data;
    for (let i = 0; i < 20; i++) {
      data = (await db.doc(path).get()).data();
      if (test(data)) return { ok: true, data };
      await new Promise((ok) => setTimeout(ok, 250));
    }
    return { ok: false, data };
  };
  const teamPath = `events/${drawEventId}/teams/${teamA.id}`;
  const drawnA = (await db.doc(teamPath).get()).get("memberIds");
  const absentOne = drawnA[drawnA.length - 1];
  const presentOnes = drawnA.filter((id) => id !== absentOne);
  const absentName = (await db.doc(`founders/${absentOne}`).get()).get("name");
  a = await run("mark_attendance", { eventId: drawEventId, marks: [{ founderId: absentOne, status: "absent" }] });
  let d = await docWhen(teamPath, (x) => JSON.stringify(x?.absentMemberIds) === JSON.stringify([absentOne]) && x.memberIds.includes(absentOne));
  check(d.ok, "an absence after the draw masks the member, who stays in the draw", d.data);
  w = await teamRowIs(presentOnes);
  check(w.ok, "the leaderboard row drops the masked member", w.row);
  const maskedShip = (await db.collection("memberships").where("eventId", "==", drawEventId).where("founderId", "==", absentOne).get()).docs[0]?.data();
  check(maskedShip?.masked === true, "the masked member's team history is masked", maskedShip);
  t = await call(key, "pioneers_get", { object: "event", id: drawEventId });
  const seen = t.data?.teams?.find((x) => x.id === teamA.id);
  check(seen && !seen.memberIds.includes(absentOne) && !("absentMemberIds" in seen), "MCP get event: the masked member is not shown", seen);
  const visibleGroups = t.data?.teams?.map((x) => ({ id: x.id, memberIds: x.memberIds })) ?? [];
  t = await call(key, "pioneers_get", { object: "jury_sheet", id: drawEventId });
  check(!JSON.stringify(t.data?.targets?.find((x) => x.id === teamA.id)?.members ?? []).includes(absentName.split(" ")[0]), "jury sheet: the masked member is not listed", t.data?.targets?.find((x) => x.id === teamA.id));
  // Les groupes tels que le MCP les montre, renvoyes tels quels (le leader change, pour avoir une retouche).
  a = await run("edit_teams", { eventId: drawEventId, teams: visibleGroups.map((g) => (g.id === teamA.id ? { ...g, leaderId: presentOnes[presentOnes.length - 1] } : g)) });
  d = await docWhen(teamPath, (x) => JSON.stringify(x?.memberIds) === JSON.stringify(drawnA) && (x.absentMemberIds ?? []).includes(absentOne));
  check(a.applied && !a.applied.isError && d.ok, "edit_teams with the groups as read keeps the masked member in the draw", { result: a.applied?.data ?? a.preview.data, team: d.data });
  a = await run("mark_attendance", { eventId: drawEventId, marks: [{ founderId: absentOne, status: "present" }] });
  d = await docWhen(teamPath, (x) => (x?.absentMemberIds ?? []).length === 0);
  w = await teamRowIs(drawnA);
  check(d.ok && w.ok, "marked present again, the member is back in the group and its row", { team: d.data, row: w.row });
  a = await run("mark_attendance", { eventId: drawEventId, marks: drawnA.map((founderId) => ({ founderId, status: "absent" })) });
  w = await rowWhen(drawEventId, teamA.id, (row) => !row);
  t = await call(key, "pioneers_get", { object: "event", id: drawEventId });
  check(w.ok && !t.data?.teams?.some((x) => x.id === teamA.id), "a group with nobody present is hidden and out of the ranking", w.row);
  await run("mark_attendance", { eventId: drawEventId, marks: drawnA.map((founderId) => ({ founderId, status: "present" })) });
  w = await teamRowIs(drawnA);
  check(w.ok, "everyone present again: the group is back in the ranking", w.row);
  await db.doc(teamPath).update({ memberIds: teamA.memberIds });

  t = await call(key, "pioneers_create_event", { batchId: "fall-2026", templateKey: "pitch_day", name: "Pitch check", startDateISOString: "2026-12-02T09:30:00+01:00" });
  t = await call(key, "pioneers_create_event", { planId: t.data?.planId });
  const pitchId = t.data?.result?.eventId;
  a = await run("update_event", { eventId: pitchId, startupIds: ["lumen"] });
  const lumenName = (await db.doc("startups/lumen").get()).get("name");
  const lumenRow = (test) => rowWhen(pitchId, "lumen", test);
  await judgeScore(pitchId, "startup", "lumen", { teamStrength: 4 });
  w = await lumenRow((row) => row?.name === lumenName);
  check(w.ok, "a pitch ranks its startup once scored", w.row);
  await db.doc("startups/lumen").update({ name: "Lumen Renamed" });
  w = await lumenRow((row) => row?.name === "Lumen Renamed");
  check(w.ok, "a renamed startup: the pitch leaderboard follows", w.row);
  await db.doc("startups/lumen").update({ name: lumenName });
  a = await run("update_event", { eventId: pitchId, startupIds: [] });
  w = await lumenRow((row) => !row);
  check(w.ok, "update_event removes a startup: its row leaves the leaderboard", w.row);
  await db.doc(`events/${pitchId}`).update({ startupIds: ["lumen"] });
  w = await lumenRow((row) => row?.name === lumenName);
  check(w.ok, "a direct write (Admin screen) adds it back: the leaderboard follows", w.row);

  // Parite avec l'Admin (19/11) : bareme, metrique, noms publics, Slack du batch, champs staff, import, photo, recherche
  // Un refus attendu : a l'apercu, ou a la confirmation pour une action hors transaction (`apply`).
  const refuses = async (action, args, code, label, apply = false) => {
    let r = await call(key, "pioneers_run", { action, args });
    if (apply && !r.isError) r = await call(key, "pioneers_run", { planId: r.data?.planId });
    check(r.isError && code.test(r.data), label, r.data);
  };
  const scoringItems = (await db.doc(`events/${drawEventId}`).get()).get("scoring")?.items ?? [];
  a = await run("set_event_scoring", { eventId: drawEventId, items: scoringItems });
  check(a.applied && !a.applied.isError && JSON.stringify((await db.doc(`events/${drawEventId}`).get()).get("scoring")?.items) === JSON.stringify(scoringItems), "set_event_scoring sets the grid", a.applied?.data ?? a.preview.data);
  a = await run("set_ranking_metric", { eventId: "demo-hackathon-1", metricKey: "callsMade" });
  w = await rowWhen("demo-hackathon-1", "team-a", (row) => row?.score === 12);
  check(a.applied && !a.applied.isError && w.ok, "set_ranking_metric ranks the event by a metric", w.row ?? a.preview.data);
  await run("set_ranking_metric", { eventId: "demo-hackathon-1", metricKey: null });
  await db.doc(`events/${drawEventId}/teams/${teamA.id}`).update({ memberNames: null });
  a = await run("refresh_team_names", { eventId: drawEventId });
  check((await db.doc(`events/${drawEventId}/teams/${teamA.id}`).get()).get("memberNames")?.length === teamA.memberIds.length, "refresh_team_names restores the public names", a.preview.data);
  a = await run("update_batch", { batchId: "fall-2026", slackTeamId: "t0123abcd", slackChannelId: "C0123ABCD" });
  rb = (await db.doc("batches/fall-2026").get()).get("settings");
  check(rb.slackTeamId === "T0123ABCD" && rb.slackChannelId === "C0123ABCD", "update_batch sets the batch's Slack workspace and channel", a.applied?.data ?? a.preview.data);
  await refuses("update_batch", { batchId: "fall-2026", slackChannelId: "X12" }, /channel ID/, "update_batch refuses a wrong Slack channel ID");
  a = await run("update_batch", { batchId: "fall-2026", resources: [{ label: " Handbook ", url: "notion.so/handbook", description: " " }, { label: "Calendar", url: "/programs/accelerator/batches/fall-2026/calendar" }] });
  const rr = (await db.doc("batchResources/fall-2026").get()).get("items");
  check(
    JSON.stringify(rr) === JSON.stringify([{ label: "Handbook", description: null, url: "https://notion.so/handbook" }, { label: "Calendar", description: null, url: "/programs/accelerator/batches/fall-2026/calendar" }]),
    "update_batch sets the batch's resources, cleaned, in order",
    a.applied?.data ?? a.preview.data,
  );
  await refuses("update_batch", { batchId: "fall-2026", resources: [{ label: "", url: "https://x.org" }] }, /label/, "update_batch refuses a resource without a label");
  await run("update_batch", { batchId: "fall-2026", resources: [] });
  const ada = (await db.doc("founders/ada-example").get()).data();
  const adaSlackBefore = (await db.doc(`people/${ada.personId}`).get()).get("slackUserId") ?? null;
  a = await run("set_founder_staff_fields", { founderId: "ada-example", trackRecordOneLiner: "Built two dev tools", slackUserId: "u0123abcd" });
  const adaDir = (await db.doc("founders/ada-example/private/directory").get()).data();
  const adaPerson = (await db.doc(`people/${ada.personId}`).get()).data();
  check((await db.doc("founders/ada-example").get()).get("trackRecordOneLiner") === "Built two dev tools" && adaDir.slackUserId === "U0123ABCD" && adaPerson.slackUserId === "U0123ABCD", "set_founder_staff_fields writes the one-liner and the Slack ID (and its copy)", a.applied?.data ?? a.preview.data);
  await refuses("set_founder_staff_fields", { founderId: "ada-example", slackUserId: "nope" }, /member ID/, "set_founder_staff_fields refuses a wrong Slack ID");
  await run("set_founder_staff_fields", { founderId: "ada-example", trackRecordOneLiner: ada.trackRecordOneLiner ?? null, slackUserId: adaSlackBefore });
  a = await run("create_founders", { batchId: "fall-2026", founders: [{ firstName: "Nora", lastName: "Newcomer", email: "nora.newcomer@pioneers.test", profileCategory: "technical" }, { firstName: "Omar", lastName: "Noemail" }] });
  const newIds = a.applied?.data?.result?.founderIds ?? [];
  const nora = newIds[0] ? (await db.doc(`founders/${newIds[0]}`).get()).data() : null;
  const noraDocs = newIds[0] ? await Promise.all(["directory", "profile", "internal"].map((d) => db.doc(`founders/${newIds[0]}/private/${d}`).get())) : [];
  check(newIds.length === 2 && nora?.name === "Nora Newcomer" && nora.batchId === "fall-2026" && noraDocs.every((d) => d.exists) && noraDocs[0].get("email") === "nora.newcomer@pioneers.test", "create_founders creates the profiles and their private documents", a.applied?.data ?? a.preview.data);
  check((await db.doc(`people/${nora?.personId}`).get()).get("founderIds")?.includes(newIds[0]), "create_founders creates the person", nora);
  await refuses("create_founders", { batchId: "fall-2026", founders: [{ firstName: "Ada", lastName: "Example" }] }, /already_in_batch/, "create_founders refuses a founder already in the batch");
  a = await run("archive_founder", { founderId: newIds[1], archived: true });
  // Une image servie en local : la fonction la telecharge, la reduit, la depose dans Storage.
  const sharp = require("sharp");
  const png = await sharp({ create: { width: 600, height: 500, channels: 3, background: "#0db0f5" } }).png().toBuffer();
  const small = await sharp({ create: { width: 120, height: 120, channels: 3, background: "#0db0f5" } }).png().toBuffer();
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": req.url === "/page" ? "text/html" : "image/png" });
    res.end(req.url === "/small.png" ? small : req.url === "/page" ? "<html></html>" : png);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const imageBase = `http://127.0.0.1:${server.address().port}`;
  a = await run("set_founder_photo", { founderId: newIds[0], imageUrl: `${imageBase}/photo.png` });
  let noraNow = (await db.doc(`founders/${newIds[0]}`).get()).data();
  check(a.applied && !a.applied.isError && noraNow.photoUrl?.startsWith("data:image/jpeg;base64,") && /photo-.+\.jpg/.test(decodeURIComponent(noraNow.coverPhotoUrl ?? "")), "set_founder_photo stores the large photo and the thumbnail", a.applied?.data ?? a.preview.data);
  await refuses("set_founder_photo", { founderId: newIds[0], imageUrl: `${imageBase}/small.png` }, /image_too_small/, "set_founder_photo refuses an image under 400 px", true);
  await refuses("set_founder_photo", { founderId: newIds[0], imageUrl: `${imageBase}/page` }, /not_an_image/, "set_founder_photo refuses a web page", true);
  a = await run("set_founder_photo", { founderId: newIds[0], imageUrl: null });
  noraNow = (await db.doc(`founders/${newIds[0]}`).get()).data();
  check(noraNow.photoUrl === null && noraNow.coverPhotoUrl === null, "set_founder_photo removes the photo", noraNow);
  server.close();
  t = await call(key, "pioneers_list", { object: "fields", search: "linkedin" });
  check(t.data?.items?.length === 1 && t.data.items[0].dbField === "person.linkedinUrl", "list fields filters by `search`", t.data?.items?.map((f) => f.dbField));
  t = await call(key, "pioneers_list", { object: "fields", search: "whatsapp" });
  check(t.data?.items?.length >= 1 && t.data.items.every((f) => /whatsapp/i.test(`${f.dbField} ${f.label}`)), "list fields: search by label or address", t.data?.items?.map((f) => f.dbField));

  // Jury et classement
  t = await call(key, "pioneers_run", { action: "delete_jury_score", args: { eventId: "demo-hackathon-2", evaluationId: "nope" } });
  check(t.isError && /evaluation_not_found/.test(t.data), "delete_jury_score refuses an unknown score", t.data);
  a = await run("reset_jury_link", { eventId: "demo-hackathon-2" });
  check(a.applied && !a.applied.isError && !JSON.stringify(a.applied.data).includes("secret"), "reset_jury_link replaces the link without showing it", a.applied?.data);
  t = await call(key, "pioneers_run", { action: "publish_ranking", args: { eventId: "demo-masterclass", publish: true } });
  check(t.isError && /no_scoring/.test(t.data), "publish_ranking needs a scoring grid", t.data);
  t = await call(key, "pioneers_get", { object: "event", id: "demo-hackathon-1" });
  check(!t.isError && Array.isArray(t.data.evaluations) && Array.isArray(t.data.leaderboard?.rows), "get event: staff read jury scores and the leaderboard", Object.keys(t.data ?? {}));

  // Reponses en attente : une valeur a refuser
  await db.doc("formResponses/check-pending").set({
    programId: "accelerator", batchId: "fall-2026", formId: "demo-weekly-form", formKind: "weekly_update", formVersion: 1,
    respondentPersonId: null, respondentFounderId: "ada-example", subjects: { founderId: "ada-example" }, answers: { q1: "x" },
    writes: [{ questionId: "q1", dbField: "founder.trackRecordOneLiner", path: "founders/ada-example", value: "x", previousValue: null, status: "pending_approval", reason: null, decidedByUid: null, decidedDateISOString: null }],
    unmatched: [], status: "pending_approval", submittedDateISOString: new Date().toISOString(),
  });
  t = await call(key, "pioneers_list", { object: "responses", formId: "demo-weekly-form", pendingOnly: true });
  check(t.data?.items?.length === 1 && t.data.items[0].writes[0].writeIndex === 0, "list responses: those waiting for approval", t.data);
  t = await call(key, "pioneers_list", { object: "responses", formId: "demo-weekly-form", search: "nobody by this name" });
  check(Array.isArray(t.data?.items) && t.data.items.length === 0, "list responses filters by `search` (respondent)", t.data);
  t = await call(key, "pioneers_list", { object: "responses", formId: "demo-peer-1" });
  check(t.isError && /private_answers/.test(t.data), "peer-rating responses are never listed", t.data);
  a = await run("decide_form_write", { responseId: "check-pending", writeIndex: 0, approve: false });
  check((await db.doc("formResponses/check-pending").get()).get("writes")[0].status === "rejected", "decide_form_write rejects a pending value", a.applied?.data);

  // Revues, Background, startups, presence optionnelle
  a = await run("review_founder_update", { founderId: "ada-example", weekStartDayString: "2026-11-16", goalAmbitious: true, goalReached: false, comment: "Good week" });
  check((await db.doc("founderReviews/ada-example_2026-11-16").get()).get("goalAmbitious") === true, "review_founder_update writes the review", a.applied?.data);
  t = await call(key, "pioneers_run", { action: "review_founder_update", args: { founderId: "ada-example", weekStartDayString: "2026-11-16" } });
  check(t.isError && /invalid_review/.test(t.data), "a review answers at least one question", t.data);
  a = await run("review_startup_update", { startupId: "lumen", weekStartDayString: "2026-11-16", scores: { traction: 4, progress: 3 } });
  check((await db.doc("startupReviews/lumen_2026-11-16").get()).get("scores")?.traction === 4, "review_startup_update writes the review", a.applied?.data);
  a = await run("rate_background", { founderId: "ben-sample", scores: { execution: 4, founderSignal: 3, pedigree: 3, geography: 2 } });
  check((await db.doc("founders/ben-sample/private/internal").get()).get("background")?.scores?.execution === 4, "rate_background writes the staff rating", a.applied?.data);
  a = await run("rate_edge", { founderId: "ben-sample", score: 4 });
  {
    const edge = (await db.doc("founders/ben-sample/private/internal").get()).get("edge");
    check(edge?.score === 4 && edge.ratedText === "Ships fast and never gives up.", "rate_edge writes the staff rating with the rated text", a.applied?.data);
  }
  t = await call(key, "pioneers_run", { action: "rate_edge", args: { founderId: "ben-sample", score: 6 } });
  check(t.isError, "rate_edge refuses a score above 5", t.data);
  await db.doc("founders/chloe-demo/private/directory").set({ edge: null }, { merge: true });
  t = await call(key, "pioneers_run", { action: "rate_edge", args: { founderId: "chloe-demo", score: 3 } });
  check(t.isError && /edge_missing/.test(t.data), "rate_edge refuses a founder without an edge", t.data);
  a = await run("create_startups", { batchId: "fall-2026", startups: [{ name: "Check Labs", memberIds: ["chloe-demo", "dan-placeholder"] }] });
  const newStartupId = a.applied?.data?.result?.startupIds?.[0];
  check(newStartupId && (await db.doc("founders/chloe-demo").get()).get("startupId") === newStartupId, "create_startups creates the startup and links its members", a.applied?.data);
  t = await call(key, "pioneers_run", { action: "create_startups", args: { batchId: "fall-2026", startups: [{ name: "Again", memberIds: ["chloe-demo"] }] } });
  check(t.isError, "a founder already in a startup is refused", t.data);
  a = await run("set_attendance_optional", { eventId: "demo-masterclass", optional: true });
  check((await db.doc("events/demo-masterclass").get()).get("attendanceOptional") === true, "set_attendance_optional", a.applied?.data);

  // ---- Noter un jury avec Claude (fiche de notation, puis toutes les notes d'un coup) ----
  t = await call(key, "pioneers_get", { object: "jury_sheet", id: "demo-hackathon-2" });
  const sheet = t.data;
  const critKeys = sheet?.grid?.criteria?.map((c) => c.key) ?? [];
  check(!t.isError && critKeys.includes("execution") && sheet.targets?.length === 2 && sheet.targets.every((x) => x.name) && sheet.juryForm?.locked === false && sheet.juror, "jury_sheet: the grid, every team, the juror's name", t.data);
  check(!/peerRating|pickedFounderIds/.test(JSON.stringify(sheet)), "jury_sheet carries no peer rating nor pick");
  // Le suivi du staff : un statut par equipe, ce qu'elle doit et qui (des noms : staff seulement), un total par statut.
  const STATUSES = ["to_score", "incomplete", "waiting", "no_submission", "scored"];
  check(
    sheet.targets.every((x) => STATUSES.includes(x.status) && (x.status !== "incomplete" || x.owes?.length)) &&
      STATUSES.every((s) => sheet.summary?.[s] === sheet.targets.filter((x) => x.status === s).length),
    "jury_sheet: a status per team and a summary",
    { summary: sheet.summary, targets: sheet.targets.map((x) => [x.id, x.status, x.owes]) },
  );
  const founderIds = new Set((await db.collection("founders").select().get()).docs.map((d) => d.id));
  const owes = sheet.targets.flatMap((x) => x.owes ?? []);
  check(
    owes.length > 0 && owes.every((o) => o.form && ["team", "each_member"].includes(o.due) && o.founders.length && o.founders.every((n) => typeof n === "string" && !founderIds.has(n))),
    "jury_sheet: what each team still owes, by full name",
    owes,
  );
  const fullScores = (n) => Object.fromEntries(sheet.grid.criteria.map((c) => [c.key, Math.min(c.max, Math.max(c.min, n))]));
  t = await call(key, "pioneers_run", { action: "score_jury", args: { eventId: "demo-hackathon-2", evaluations: [{ targetId: "team-c", scores: { ...fullScores(4), nope: 3 } }] } });
  check(t.isError && /unknown_criterion/.test(t.data), "score_jury refuses an unknown criterion", t.data);
  t = await call(key, "pioneers_run", { action: "score_jury", args: { eventId: "demo-hackathon-2", evaluations: [{ targetId: "team-c", scores: { [critKeys[0]]: 99 } }] } });
  check(t.isError && /invalid_score|missing_score/.test(t.data), "score_jury refuses a score off the scale", t.data);
  t = await call(key, "pioneers_run", { action: "score_jury", args: { eventId: "demo-hackathon-2", evaluations: [{ targetId: "team-x", scores: fullScores(3) }] } });
  check(t.isError && /not_a_target/.test(t.data), "score_jury refuses a team outside the jury", t.data);
  a = await run("score_jury", {
    eventId: "demo-hackathon-2",
    evaluations: [
      { targetId: "team-c", scores: fullScores(5), rationale: { [critKeys[0]]: "Drive shows 12 signed calls, best of the batch." } },
      { targetId: "team-d", scores: fullScores(3), rationale: { [critKeys[0]]: "Claims 8 calls, only 3 backed by screenshots." }, comment: "Ask for the missing proofs." },
    ],
  });
  const table = a.preview.data?.preview?.table ?? [];
  check(table.length === 2 && table[0].team === "Team Demo C" && table[0].rank === 1 && /with Claude/.test(a.preview.data.preview.juror), "score_jury previews the whole table, ranked", a.preview.data);
  // Par le formulaire de jury, sous le nom complet du staff : le meme jure que par le lien.
  const juryResponses = await db.collection("formResponses").where("formId", "==", "demo-jury-2").where("recordedVia", "==", "mcp").get();
  const judgeId = juryResponses.docs[0]?.get("respondentJudgeId");
  const evalC = judgeId ? (await db.doc(`events/demo-hackathon-2/evaluations/${judgeId}_team-c`).get()).data() : null;
  check(evalC?.evaluatorKind === "judge" && /^jury-/.test(evalC.evaluatorId) && evalC.scores[critKeys[0]] === sheet.grid.criteria[0].max && /Drive shows/.test(evalC.comment ?? "") && juryResponses.size === 1, "score_jury sends the jury form under the staff's name, with its justification", { evalC, responses: juryResponses.size });
  t = await call(key, "pioneers_run", { action: "score_jury", args: { eventId: "demo-hackathon-2", evaluations: [{ targetId: "team-c", scores: fullScores(4) }] } });
  check(t.data?.preview?.table?.[0]?.replacesYourScore === true, "scoring again replaces your own score", t.data);
  t = await call(key, "pioneers_get", { object: "jury_sheet", id: "demo-hackathon-2" });
  check(t.data?.targets?.find((x) => x.id === "team-c")?.yourScore?.scores, "the jury sheet shows your earlier score", t.data?.targets);
  await run("set_form_status", { formId: "demo-jury-2", status: "closed" });
  t = await call(key, "pioneers_run", { action: "score_jury", args: { eventId: "demo-hackathon-2", evaluations: [{ targetId: "team-c", scores: fullScores(4) }] } });
  check(t.isError && /jury_locked/.test(t.data), "a closed jury form locks the scores", t.data);
  await run("set_form_status", { formId: "demo-jury-2", status: "open" });

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
  check(adaTools.includes("pioneers_set_fields") && !adaTools.includes("pioneers_add_note") && !adaTools.includes("pioneers_run"), `founder catalogue: ${adaTools.join(", ")}`);
  {
    // Lock my team et revues : jamais pour un fondateur ni un investor, meme IC (staff seulement).
    for (const [k, who] of [[adaKey, "founder"], [icKey, "IC investor"]]) {
      const got = await call(k, "pioneers_get", { object: "founder", id: "ada-example" });
      check(!/Secret lock|teamLock|goalAmbitious|weeklyReviews/.test(JSON.stringify(got.data)), `${who}: no team lock nor weekly review`, JSON.stringify(got.data).slice(0, 200));
      const locks = await call(k, "pioneers_list", { object: "team_locks", batchId: "fall-2026" });
      check(locks.isError, `${who}: list team_locks refused`, locks.data);
      const sheetTry = await call(k, "pioneers_get", { object: "jury_sheet", id: "demo-hackathon-2" });
      check(sheetTry.isError, `${who}: jury_sheet refused`, sheetTry.data);
    }
  }
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
  // Education en liste (15/11) : une ancienne valeur texte est decoupee (« ; », « · ») puis fusionnee, sans perte.
  await getFirestore().doc("founders/ada-example/private/directory").update({ education: "Demo University; Grenoble INP - Phelma - Data Science, AI" });
  t = await call(adaKey, "pioneers_set_fields", { subjects: { founderId: "ada-example" }, values: { "founderDirectory.education": ["HEC Paris", "Demo University"] } });
  t = await call(adaKey, "pioneers_set_fields", { planId: t.data.planId });
  const adaEducation = (await getFirestore().doc("founders/ada-example/private/directory").get()).get("education");
  check(
    JSON.stringify(adaEducation) === JSON.stringify(["Demo University", "Grenoble INP - Phelma - Data Science, AI", "HEC Paris"]),
    "education: legacy text split, then merged as a list",
    adaEducation,
  );
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
  check(g.body.internal && !("eloScore" in g.body.internal), "the archived Elo is not returned (17/11)", g.body.internal);
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
  check(oauthList.status === 200 && oauthList.body.result?.tools?.length === 9, "MCP works with the OAuth access token", oauthList.body);
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
