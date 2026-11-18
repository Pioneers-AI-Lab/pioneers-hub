// ----------------------------
// Inventaire en LECTURE SEULE d'un batch reel : evenements a venir, leurs formulaires
// (questions, identite, dates, statut, version publiee), tirages et baremes.
// Sert a comparer la prod a docs/FONCTIONNALITES.md (17/11).
// node scripts/audit-fa26.mjs [batchId] [--from YYYY-MM-DD] > inventaire.json
// ----------------------------
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const batchId = args.find((a) => !a.startsWith("--")) ?? "fall-2026";
const fromAt = args.indexOf("--from");
const from = fromAt === -1 ? new Date().toISOString().slice(0, 10) : args[fromAt + 1];

initializeApp({ projectId: "pioneers-3627c", credential: applicationDefault() });
const db = getFirestore();

const events = (await db.collection("events").where("batchId", "==", batchId).get()).docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((e) => (e.endDateISOString ?? e.startDateISOString ?? "").slice(0, 10) >= from)
  .sort((a, b) => (a.startDateISOString ?? "").localeCompare(b.startDateISOString ?? ""));
const forms = (await db.collection("forms").where("batchId", "==", batchId).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

const answers = async (formId) => (await db.collection("formResponses").where("formId", "==", formId).count().get()).data().count;
const question = (q) => ({
  id: q.id,
  type: q.type,
  label: q.label,
  dbField: q.dbField ?? null,
  scope: q.scope ?? null,
  required: q.required,
  ...(q.scale ? { scale: `${q.scale.min}-${q.scale.max}` } : {}),
  ...(q.options ? { options: q.options } : {}),
  ...(q.picker ? { picker: q.picker } : {}),
  ...(q.weight != null ? { weight: q.weight } : {}),
  ...(q.archived ? { archived: true } : {}),
});
async function formView(f) {
  const [versionSnap, responses] = await Promise.all([
    f.publishedVersion ? db.doc(`forms/${f.id}/versions/${f.publishedVersion}`).get() : null,
    answers(f.id),
  ]);
  const v = versionSnap?.data() ?? null;
  return {
    id: f.id,
    kind: f.kind,
    title: f.title,
    status: f.status,
    archived: Boolean(f.archivedDateISOString),
    identity: f.identityCheck ?? f.identity ?? null,
    opens: f.opensDateISOString ?? null,
    deadline: f.deadlineDateISOString ?? null,
    responses,
    description: f.description ?? null,
    questions: (v?.questions ?? f.questions ?? []).map(question),
  };
}

const eventView = async (e) => {
  const teams = (await db.collection(`events/${e.id}/teams`).get()).size;
  return {
    id: e.id,
    name: e.name,
    start: e.startDateISOString,
    end: e.endDateISOString,
    kind: e.kind,
    templateKey: e.templateKey ?? null,
    status: e.status,
    archived: Boolean(e.archivedDateISOString),
    linkedToCalendar: Boolean(e.calendarSource),
    attendance: e.attendance ?? null,
    matching: e.matching ?? null,
    teams,
    scoring: e.scoring ?? null,
    forms: await Promise.all(forms.filter((f) => f.eventId === e.id).map(formView)),
  };
};
const out = {
  batchId,
  from,
  events: await Promise.all(events.map(eventView)),
  formsWithoutEvent: await Promise.all(forms.filter((f) => !f.eventId).map(formView)),
};
console.log(JSON.stringify(out, null, 2));
