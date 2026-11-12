import { HttpsError } from "firebase-functions/v2/https";
import { ApiError } from "../api/errors";
import { getFirestore, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { COL, docPaths, eventCollectionPaths } from "../shared/collections";
import { isStaffViewer, publicShortName } from "../shared/access";
import {
  enumOptions,
  getFieldDef,
  isEmptyValue,
  listKeyOf,
  parseDbField,
  resolveDocPath,
  SUBJECT_INPUT_KEY,
  type DbFieldKey,
  type ResolvedSubjects,
  type SubjectKey,
} from "../shared/fieldRegistry";
import { FORM_ANSWER_MAX, answerToFieldValue } from "../shared/formRules";
import type { CallableRequest, CallableResponse, PublicChoice, PublicForm, PublicFormQuestion } from "../shared/callables";
import type {
  Batch,
  BatchMembership,
  ClosedList,
  EventTeam,
  FieldWrite,
  Form,
  FormAnswer,
  FormQuestion,
  FormResponse,
  Founder,
  Mentor,
  Person,
  PickerEntity,
  PioneersEvent,
  Startup,
  SubjectSource,
  UnmatchedAnswer,
} from "../shared/types";
import type { Caller } from "../api/caller";
import { founderIdIn, loadAccount } from "../api/viewer";
import { writeAudit, writeUiAudit } from "./audit";
import { cleanId, cleanText, cleanUrl, invalidArgument } from "./clean";
import { planFieldWrites, type FieldChange } from "./fields";
import { plain } from "./operations";
import { parisMonday } from "./schemas";

// ----------------------------
// services - les formulaires publics (SPECS §3.5, §4.4)
// ----------------------------
// Un formulaire se remplit SANS COMPTE, depuis le lien que le staff partage
// (page /forms/[formId]). Deux callables :
//
//   getPublicForm       ce que la page affiche : questions, options resolues,
//                       listes a choisir, et les noms du batch en nom court.
//                       Les fiches fondateurs ne sont pas publiques (regles
//                       `founders`) : c'est le serveur qui rend les noms.
//   submitFormResponse  la reponse : validee question par question, rattachee
//                       (fondateur, startup, semaine, evenement, equipe), puis
//                       chaque `dbField` est ecrit par le plan de `set_fields`
//                       en mode partiel (un champ fautif est ecarte, pas toute
//                       la reponse), ou mis en attente de validation du staff.
//
// Le repondant ne choisit que son nom (jamais tape) et ses reponses. Ce que le
// formulaire ECRIT, c'est le staff qui l'a decide en le creant : les champs
// (`dbField`) et d'ou viennent les sujets (`attachments`). Les ecritures
// passent donc avec les droits du staff, bornees a ces champs.

const db = () => getFirestore();


/** Tire une fois par ouverture de la page (`crypto.randomUUID`). */
const SUBMISSION_ID = /^[A-Za-z0-9-]{16,64}$/;

function formState(form: Form, nowISO: string): PublicForm["state"] {
  if (form.status === "draft") return "draft";
  if (form.status === "closed") return "closed";
  if (form.opensDateISOString && form.opensDateISOString > nowISO) return "not_open_yet";
  return "open";
}

const NOT_OPEN: Record<Exclude<PublicForm["state"], "open">, string> = {
  closed: "This form is closed.",
  not_open_yet: "This form is not open yet.",
  draft: "This form is a draft: publish it to collect answers.",
};

const activeQuestions = (form: Form) => form.questions.filter((q) => !q.archived);

/** Les listes fermees que lisent les questions a choix de ce formulaire. */
const listKeysOf = (questions: FormQuestion[]) => [
  ...new Set(questions.flatMap((q) => (q.dbField ? (listKeyOf(getFieldDef(q.dbField).value) ?? []) : []))),
];

const listsFrom = (snaps: DocumentSnapshot[]) =>
  new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data() as ClosedList] as const));

/** Les options d'une question a choix : celles du champ cible (liste fermee, valeurs fixes et leur libelle), sinon celles du staff. */
function optionsOf(q: FormQuestion, lists: Map<string, ClosedList>): PublicChoice[] | null {
  if (q.type !== "single_choice" && q.type !== "multiple_choice") return null;
  const fromField = q.dbField ? enumOptions(getFieldDef(q.dbField).value, lists) : null;
  const options = fromField ?? (q.options ?? []).filter((o) => o.trim()).map((o) => ({ value: o, label: o }));
  return options.map((o) => ({ ...o, hint: null }));
}

// ---- getPublicForm ---------------------------------------------------------------

const byLabel = (a: PublicChoice, b: PublicChoice) => a.label.localeCompare(b.label);

const parisShortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Paris" });

/**
 * Les listes « choisir dans une liste » qui ne sont ni les fondateurs ni les
 * startups (deja lus pour les noms). Champs projetes : les fiches portent des
 * vignettes en `data:` URL qu'il serait inutile de telecharger.
 */
const OTHER_PICKERS: Partial<Record<PickerEntity, (form: Form) => Promise<PublicChoice[]>>> = {
  event: async (form) => {
    const snap = await db()
      .collection(COL.events)
      .where("batchId", "==", form.batchId)
      .select("name", "startDateISOString", "archivedDateISOString")
      .get();
    return snap.docs
      .map((d) => ({ id: d.id, e: d.data() as Pick<PioneersEvent, "name" | "startDateISOString" | "archivedDateISOString"> }))
      .filter(({ e }) => e.archivedDateISOString === null)
      .sort((a, b) => b.e.startDateISOString.localeCompare(a.e.startDateISOString))
      .map(({ id, e }) => ({ value: id, label: e.name, hint: parisShortDay(e.startDateISOString) }));
  },
  team: async (form) => {
    if (!form.eventId) return [];
    const snap = await db()
      .collection(eventCollectionPaths.teams(form.eventId))
      .where("publishedDateISOString", "!=", null)
      .select("name", "memberNames")
      .get();
    return snap.docs
      .map((d) => {
        const t = d.data() as Pick<EventTeam, "name" | "memberNames">;
        return { value: d.id, label: t.name, hint: t.memberNames?.join(", ") || null };
      })
      .sort(byLabel);
  },
  mentor: async () => {
    const snap = await db().collection(COL.mentors).where("archivedDateISOString", "==", null).select("personId", "company").get();
    if (snap.empty) return [];
    const mentors = snap.docs.map((d) => ({ id: d.id, m: d.data() as Pick<Mentor, "personId" | "company"> }));
    const people = await db().getAll(...mentors.map(({ m }) => db().doc(docPaths.person(m.personId))), { fieldMask: ["displayName"] });
    return mentors
      .map(({ id, m }, i) => ({ value: id, label: (people[i].data() as Person | undefined)?.displayName ?? "Mentor", hint: m.company }))
      .sort(byLabel);
  },
};

export async function getPublicForm(uid: string | null, formIdRaw: unknown): Promise<PublicForm> {
  const formId = cleanId(formIdRaw, "formId");
  const [snap, account] = await Promise.all([db().doc(docPaths.form(formId)).get(), uid ? loadAccount(uid) : null]);
  const form = snap.exists ? (snap.data() as Form) : null;
  // Un brouillon n'existe pas pour le public ; le staff l'ouvre pour le relire.
  if (!form || form.archivedDateISOString !== null || (form.status === "draft" && !isStaffViewer(account?.viewer ?? null))) {
    throw new HttpsError("not-found", "This form does not exist or was removed.");
  }

  const questions = activeQuestions(form);
  const entities = [...new Set(questions.flatMap((q) => (q.type === "entity_picker" && q.picker ? [q.picker.entity] : [])))];
  const needsFounders = form.identityCheck !== "anonymous" || entities.includes("founder");
  const needsStartups = needsFounders || entities.includes("startup");
  const listKeys = listKeysOf(questions);
  const others = entities.flatMap((e) => {
    const load = OTHER_PICKERS[e];
    return load ? [load(form).then((choices) => [e, choices] as const)] : [];
  });

  const [batchSnap, foundersSnap, startupsSnap, listSnaps, otherChoices] = await Promise.all([
    db().doc(docPaths.batch(form.batchId)).get(),
    needsFounders
      ? db().collection(COL.founders).where("batchId", "==", form.batchId).select("name", "startupId", "archivedDateISOString").get()
      : null,
    needsStartups ? db().collection(COL.startups).where("batchId", "==", form.batchId).select("name", "archivedDateISOString").get() : null,
    listKeys.length ? db().getAll(...listKeys.map((k) => db().doc(docPaths.list(k)))) : [],
    Promise.all(others),
  ]);

  const startups = (startupsSnap?.docs ?? [])
    .map((d) => ({ id: d.id, s: d.data() as Pick<Startup, "name" | "archivedDateISOString"> }))
    .filter(({ s }) => s.archivedDateISOString === null)
    .map(({ id, s }) => ({ value: id, label: s.name, hint: null }))
    .sort(byLabel);
  const startupNames = new Map(startups.map((s) => [s.value, s.label]));
  // Nom court (prenom + initiale) et startup : assez pour se reconnaitre sans exposer le nom complet.
  const founders = (foundersSnap?.docs ?? [])
    .map((d) => ({ id: d.id, f: d.data() as Pick<Founder, "name" | "startupId" | "archivedDateISOString"> }))
    .filter(({ f }) => f.archivedDateISOString === null)
    .map(({ id, f }) => ({ value: id, label: publicShortName(f.name), hint: f.startupId ? (startupNames.get(f.startupId) ?? null) : null }))
    .sort(byLabel);

  const choices: PublicForm["choices"] = Object.fromEntries(otherChoices);
  if (entities.includes("founder")) choices.founder = founders;
  if (entities.includes("startup")) choices.startup = startups;

  const lists = listsFrom(listSnaps);
  const publicQuestions: PublicFormQuestion[] = questions.map((q) => ({
    id: q.id,
    type: q.type,
    label: q.label,
    description: q.description,
    required: q.required,
    options: optionsOf(q, lists),
    scale: q.type === "rating" ? q.scale : null,
    picker: q.type === "entity_picker" ? q.picker : null,
  }));

  return {
    formId,
    version: form.version,
    title: form.title,
    description: form.description,
    batchName: (batchSnap.data() as Batch | undefined)?.name ?? "",
    identityCheck: form.identityCheck,
    deadlineDateISOString: form.deadlineDateISOString,
    state: formState(form, new Date().toISOString()),
    questions: publicQuestions,
    respondents: form.identityCheck === "anonymous" ? [] : founders,
    choices,
    viewerFounderId: account ? founderIdIn(account, form.batchId) : null,
  };
}

// ---- submitFormResponse : 1. les reponses ------------------------------------------

const invalid = (q: FormQuestion, message: string) => invalidArgument(q.label, message);

function cleanList(q: FormQuestion, value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  const list = Array.isArray(value) ? value : [value];
  if (!list.every((v) => typeof v === "string" && v.length > 0 && v.length <= 300)) throw invalid(q, "invalid selection.");
  const unique = [...new Set(list as string[])];
  return unique.length ? unique : null;
}

/** La reponse a une question, nettoyee ; `null` = pas de reponse. */
function cleanAnswer(q: FormQuestion, value: unknown, lists: Map<string, ClosedList>): FormAnswer {
  switch (q.type) {
    case "text":
    case "long_text":
      return cleanText(value, FORM_ANSWER_MAX[q.type], q.label);
    case "number": {
      if (value === null || value === undefined || value === "") return null;
      const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
      if (!Number.isFinite(n)) throw invalid(q, "expected a number.");
      return n;
    }
    case "rating": {
      if (value === null || value === undefined) return null;
      const scale = q.scale ?? { min: 1, max: 5 };
      if (typeof value !== "number" || !Number.isInteger(value) || value < scale.min || value > scale.max) {
        throw invalid(q, `expected a rating from ${scale.min} to ${scale.max}.`);
      }
      return value;
    }
    case "single_choice":
    case "multiple_choice": {
      const picked = cleanList(q, value);
      if (!picked) return null;
      const allowed = new Set((optionsOf(q, lists) ?? []).map((o) => o.value));
      if (picked.some((v) => !allowed.has(v))) throw invalid(q, "this option is not offered.");
      if (q.type === "multiple_choice") return picked;
      if (picked.length > 1) throw invalid(q, "choose one option.");
      return picked[0];
    }
    case "entity_picker": {
      const picked = cleanList(q, value);
      if (!picked) return null;
      const max = q.picker?.maxItems ?? 1;
      if (picked.length > max) throw invalid(q, `${max} at most.`);
      return picked;
    }
    // Pas de Storage (plan Blaze) : un fichier se donne par son lien (Drive, Dropbox...).
    case "link":
    case "file":
      return cleanUrl(value, q.label);
  }
}

function parseAnswers(questions: FormQuestion[], raw: unknown, lists: Map<string, ClosedList>): Map<string, FormAnswer> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpsError("invalid-argument", "`answers` is required.");
  const input = raw as Record<string, unknown>;
  const answers = new Map<string, FormAnswer>();
  for (const q of questions) {
    const value = cleanAnswer(q, input[q.id], lists);
    if (value !== null) answers.set(q.id, value);
    else if (q.required) throw invalid(q, "this question is required.");
  }
  return answers;
}

type Doc = Record<string, unknown>;
const inBatch = (form: Form, d: Doc) => d.batchId === form.batchId && d.archivedDateISOString === null;

/** Ou lire un objet choisi, et ce qui le rend valable pour ce formulaire. */
const PICKED: Record<PickerEntity, { path: (form: Form, id: string) => string | null; ok: (form: Form, d: Doc) => boolean }> = {
  founder: { path: (_, id) => docPaths.founder(id), ok: inBatch },
  startup: { path: (_, id) => docPaths.startup(id), ok: inBatch },
  event: { path: (_, id) => docPaths.event(id), ok: inBatch },
  team: { path: (form, id) => (form.eventId ? docPaths.team(form.eventId, id) : null), ok: (_, d) => d.publishedDateISOString != null },
  mentor: { path: (_, id) => docPaths.mentor(id), ok: (_, d) => d.archivedDateISOString === null },
};

/** Les objets choisis existent, et appartiennent au batch du formulaire (ou a son evenement). */
async function assertPickedExist(tx: Transaction, form: Form, questions: FormQuestion[], answers: Map<string, FormAnswer>) {
  const checks = questions.flatMap((q) => {
    const ids = q.type === "entity_picker" && q.picker ? ((answers.get(q.id) as string[] | undefined) ?? []) : [];
    return ids.map((id) => {
      const picked = PICKED[q.picker!.entity];
      const path = picked.path(form, cleanId(id, q.label));
      if (!path) throw invalid(q, "this form is not attached to an event.");
      return { q, path, ok: picked.ok };
    });
  });
  if (checks.length === 0) return;
  const snaps = await tx.getAll(...checks.map((c) => db().doc(c.path)));
  snaps.forEach((snap, i) => {
    if (!snap.exists || !checks[i].ok(form, snap.data() as Doc)) throw invalid(checks[i].q, "this choice is not in the list.");
  });
}

// ---- 2. le repondant et les sujets --------------------------------------------------

type Respondent = { founderId: string; founder: Founder };

/** Le lundi (`YYYY-MM-DD`) de la semaine d'un instant, a Paris. */
/** Les ids des sujets, d'apres le rattachement fixe par le staff (`Form.attachments`). */
function resolveSubjects(form: Form, respondent: Respondent | null, answers: Map<string, FormAnswer>, nowISO: string): ResolvedSubjects {
  const idFrom = (subject: SubjectKey, source: SubjectSource): string | null => {
    switch (source.from) {
      case "respondent":
        return subject === "person" ? (respondent?.founder.personId ?? null) : (respondent?.founderId ?? null);
      case "respondent_startup":
        return respondent?.founder.startupId ?? null;
      case "fixed":
        return source.id;
      case "question": {
        const answer = answers.get(source.questionId);
        return (Array.isArray(answer) ? answer[0] : typeof answer === "string" ? answer : null) ?? null;
      }
      case "form_event":
        return form.eventId;
      case "submission_week":
        return parisMonday(nowISO);
    }
  };
  const subjects: ResolvedSubjects = {};
  for (const [subject, source] of Object.entries(form.attachments) as [SubjectKey, SubjectSource][]) {
    const id = idFrom(subject, source);
    if (id) subjects[SUBJECT_INPUT_KEY[subject]] = id;
  }
  return subjects;
}

// ---- 3. les ecritures ------------------------------------------------------------

/**
 * Les droits du staff, bornes aux champs que le staff a mis dans le formulaire
 * (voir l'en-tete). `uid` : le compte du repondant s'il est connecte, sinon le
 * formulaire lui-meme, pour la presence (`markedByUid`) et l'audit.
 */
const formCaller = (actorUid: string): Caller => ({
  uid: actorUid,
  // Aucun role : l'autorite vient du formulaire (`asForm`), pas d'un faux compte staff.
  viewer: { uid: actorUid, roles: [], investorAccess: null },
  foundersByBatch: new Map(),
  via: "function",
  apiKeyId: null,
});

async function planWrites(
  tx: Transaction,
  form: Form,
  questions: FormQuestion[],
  answers: Map<string, FormAnswer>,
  subjects: ResolvedSubjects,
  actorUid: string,
  nowISO: string,
) {
  const writes: FieldWrite[] = [];
  const unmatched: UnmatchedAnswer[] = [];
  const unmatchedOf = (questionId: string, value: FormAnswer, reason: UnmatchedAnswer["reason"]) =>
    unmatched.push({ questionId, value, reason, analyzedDateISOString: null });

  // Une question par champ : si deux questions visent le meme champ, la premiere ecrit.
  const byField = new Map<DbFieldKey, { q: FormQuestion; answer: FormAnswer; value: FormAnswer }>();
  for (const q of questions) {
    const answer = answers.get(q.id);
    if (answer === undefined) continue;
    if (!q.dbField || byField.has(q.dbField)) unmatchedOf(q.id, answer, "no_db_field");
    else byField.set(q.dbField, { q, answer, value: answerToFieldValue(getFieldDef(q.dbField).value, answer) });
  }
  if (byField.size === 0) return { writes, unmatched, commit: null };

  const needsApproval = (change: FieldChange) => {
    const { q } = byField.get(change.dbField)!;
    if (getFieldDef(change.dbField).alwaysApprove) return true;
    if (q.requiresApproval !== null) return q.requiresApproval;
    if (form.approval === "all") return true;
    return form.approval === "conflicts_only" && !isEmptyValue(change.before);
  };

  const values = Object.fromEntries([...byField].map(([key, e]) => [key, e.value]));
  const plan = await planFieldWrites(tx, formCaller(actorUid), { subjects, values }, { partial: true, hold: needsApproval, asForm: true });

  const pathOf = (key: DbFieldKey) => {
    const resolved = resolveDocPath(parseDbField(key).doc, subjects);
    return resolved.ok ? resolved.path : "";
  };
  const write = (key: DbFieldKey, entry: Pick<FieldWrite, "value" | "previousValue" | "status" | "reason">): FieldWrite => ({
    questionId: byField.get(key)!.q.id,
    dbField: key,
    path: pathOf(key),
    ...entry,
    value: entry.value ?? null,
    previousValue: entry.previousValue ?? null,
    decidedByUid: null,
    decidedDateISOString: entry.status === "applied" ? nowISO : null,
  });

  for (const r of plan.rejected) {
    const { q, answer, value } = byField.get(r.dbField)!;
    unmatchedOf(q.id, answer, r.subject ? "unresolved_subject" : "invalid_value");
    if (!r.subject) writes.push(write(r.dbField, { value, previousValue: null, status: "invalid", reason: r.message }));
  }
  for (const change of plan.changes) {
    const status: FieldWrite["status"] = change.status === "unchanged" ? "unchanged" : needsApproval(change) ? "pending_approval" : "applied";
    writes.push(
      write(change.dbField, {
        value: change.after as FormAnswer,
        previousValue: change.before as FormAnswer,
        status,
        reason: change.reason ?? null,
      }),
    );
  }
  return { writes, unmatched, commit: plan.commit };
}

// ---- submitFormResponse ----------------------------------------------------------

export async function submitFormResponse(
  uid: string | null,
  req: Partial<CallableRequest<"submitFormResponse">>,
): Promise<CallableResponse<"submitFormResponse">> {
  const formId = cleanId(req.formId, "formId");
  const submissionId = String(req.submissionId ?? "");
  if (!SUBMISSION_ID.test(submissionId)) throw new HttpsError("invalid-argument", "`submissionId` is required.");
  const chosenId = typeof req.respondentFounderId === "string" && req.respondentFounderId ? cleanId(req.respondentFounderId, "respondentFounderId") : null;
  // Id deterministe : un second envoi de la meme ouverture retombe sur la meme reponse.
  const responseRef = db().collection(COL.formResponses).doc(`${formId}_${submissionId}`);

  return db().runTransaction(async (tx) => {
    const [formSnap, existing] = await tx.getAll(db().doc(docPaths.form(formId)), responseRef);
    if (existing.exists) return { responseId: existing.id, status: (existing.data() as FormResponse).status };

    const form = formSnap.data() as Form | undefined;
    if (!form || form.archivedDateISOString !== null) throw new HttpsError("not-found", "This form does not exist or was removed.");
    const nowISO = new Date().toISOString();
    const state = formState(form, nowISO);
    if (state !== "open") throw new HttpsError("failed-precondition", NOT_OPEN[state]);
    if (req.version !== form.version) {
      throw new HttpsError("failed-precondition", "This form was updated since you opened it. Reload the page to see the new version.");
    }

    // UNE lecture : les listes des questions a choix, le rattachement du compte, le nom choisi.
    const questions = activeQuestions(form);
    const listKeys = listKeysOf(questions);
    const asksIdentity = form.identityCheck !== "anonymous";
    const membershipPath = uid && asksIdentity ? docPaths.membership(form.batchId, uid) : null;
    const chosenPath = asksIdentity && chosenId ? docPaths.founder(chosenId) : null;
    const paths = [...listKeys.map(docPaths.list), ...(membershipPath ? [membershipPath] : []), ...(chosenPath ? [chosenPath] : [])];
    const snaps = new Map((paths.length ? await tx.getAll(...paths.map((p) => db().doc(p))) : []).map((d) => [d.ref.path, d]));
    const lists = listsFrom(listKeys.map((k) => snaps.get(docPaths.list(k))!));

    const answers = parseAnswers(questions, req.answers, lists);
    const linkedId = membershipPath ? ((snaps.get(membershipPath)?.data() as BatchMembership | undefined)?.founderId ?? null) : null;
    const respondent = asksIdentity ? await resolveRespondent(tx, form, linkedId, chosenId, chosenPath ? snaps.get(chosenPath)! : null) : null;
    await assertPickedExist(tx, form, questions, answers);

    const subjects = resolveSubjects(form, respondent, answers, nowISO);
    const actorUid = uid ?? `form:${formId}`;
    const { writes, unmatched, commit } = await planWrites(tx, form, questions, answers, subjects, actorUid, nowISO);

    // Toutes les lectures sont faites : on ecrit.
    commit?.(tx);
    const response: FormResponse = {
      programId: form.programId,
      batchId: form.batchId,
      formId,
      formKind: form.kind,
      formVersion: form.version,
      respondentPersonId: respondent?.founder.personId ?? null,
      respondentFounderId: respondent?.founderId ?? null,
      subjects,
      answers: Object.fromEntries(answers),
      writes,
      unmatched,
      status: responseStatus(writes),
      submittedDateISOString: nowISO,
    };
    tx.create(responseRef, plain(response));
    writeAudit(tx, formCaller(actorUid), {
      action: "submit_form_response",
      targetPath: responseRef.path,
      idempotencyKey: null,
      payload: {
        formId,
        formVersion: form.version,
        applied: writes.filter((w) => w.status === "applied").map((w) => w.dbField),
        pending: writes.filter((w) => w.status === "pending_approval").map((w) => w.dbField),
      },
    });
    return { responseId: responseRef.id, status: response.status };
  });
}

/**
 * Qui repond. `select_name` : le nom choisi dans la liste (un fondateur connecte
 * du batch repond en son nom, la page ne lui demande pas de choisir).
 * `email_code` : en attendant le code par email, l'identite est prouvee par le
 * compte (connecte et rattache au batch).
 */
async function resolveRespondent(
  tx: Transaction,
  form: Form,
  linkedId: string | null,
  chosenId: string | null,
  chosenSnap: DocumentSnapshot | null,
): Promise<Respondent> {
  if (form.identityCheck === "email_code" && !linkedId) {
    throw new HttpsError("permission-denied", "Sign in with your Pioneers account to answer this form.");
  }
  const founderId = linkedId ?? chosenId;
  if (!founderId) throw new HttpsError("invalid-argument", "Choose your name.");
  // Le profil du compte, s'il differe du nom envoye, se lit en plus (la page ne le propose pas).
  const snap = founderId === chosenId && chosenSnap ? chosenSnap : await tx.get(db().doc(docPaths.founder(founderId)));
  const founder = snap.data() as Founder | undefined;
  if (!founder || founder.batchId !== form.batchId || founder.archivedDateISOString !== null) {
    throw new HttpsError("invalid-argument", "This name is not in the batch.");
  }
  return { founderId, founder };
}

// ---- decideFormWrite (staff) -------------------------------------------------------

/** Statut d'une reponse d'apres ses ecritures : en attente tant qu'une l'est, puis partiellement refusee si une l'a ete. */
function responseStatus(writes: FieldWrite[]): FormResponse["status"] {
  if (writes.some((w) => w.status === "pending_approval")) return "pending_approval";
  return writes.some((w) => w.status === "rejected") ? "partially_rejected" : "processed";
}

/**
 * Le staff valide ou refuse une valeur en attente. Validee, elle passe par le
 * meme plan que l'API (« tout ou rien ») et se revalide contre la base
 * d'aujourd'hui : un champ « rempli si vide » rempli entre-temps reste tel quel.
 */
export async function decideFormWrite(
  staffUid: string,
  req: Partial<CallableRequest<"decideFormWrite">>,
): Promise<CallableResponse<"decideFormWrite">> {
  const responseId = cleanId(req.responseId, "responseId");
  const index = req.writeIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) throw new HttpsError("invalid-argument", "`writeIndex` is required.");
  const ref = db().collection(COL.formResponses).doc(responseId);
  // Le staff qui valide ecrit avec ses propres droits (son compte, pas l'autorite du formulaire).
  const staff: Caller = { ...(await loadAccount(staffUid)), uid: staffUid, via: "function", apiKeyId: null };

  return db().runTransaction(async (tx) => {
    const response = (await tx.get(ref)).data() as FormResponse | undefined;
    const write = response?.writes[index];
    if (!response || !write) throw new HttpsError("not-found", "No such answer.");
    if (write.status !== "pending_approval") throw new HttpsError("failed-precondition", "This value was already decided.");

    let status: FieldWrite["status"] = "rejected";
    if (req.approve === true) {
      try {
        const plan = await planFieldWrites(tx, staff, { subjects: response.subjects, values: { [write.dbField]: write.value } });
        plan.commit?.(tx);
        status = plan.commit ? "applied" : "unchanged";
      } catch (error) {
        throw error instanceof ApiError ? new HttpsError("failed-precondition", error.message) : error;
      }
    }
    const nowISO = new Date().toISOString();
    const writes = response.writes.map((w, i) => (i === index ? { ...w, status, decidedByUid: staffUid, decidedDateISOString: nowISO } : w));
    tx.update(ref, { writes, status: responseStatus(writes) });
    await writeUiAudit(tx, staffUid, "decide_form_write", ref.path, { writeIndex: index, dbField: write.dbField, status });
    return { status };
  });
}
