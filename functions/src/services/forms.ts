import { HttpsError } from "firebase-functions/v2/https";
import { ApiError } from "../api/errors";
import { getFirestore, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { COL, docPaths, eventCollectionPaths } from "../shared/collections";
import { isStaffViewer, publicShortName } from "../shared/access";
import {
  enumOptions,
  getFieldDef,
  isEmptyValue,
  isFormOnly,
  listKeyOf,
  parseDbField,
  resolveDocPath,
  SUBJECT_INPUT_KEY,
  type DbFieldKey,
  type DocKind,
  type ResolvedSubjects,
  type SubjectKey,
} from "../shared/fieldRegistry";
import { FORM_ANSWER_MAX, answerToFieldValue, fieldValueToAnswer, formNeedsTeam, ratingScale } from "../shared/formRules";
import type {
  CallableRequest,
  CallableResponse,
  PublicChoice,
  PublicForm,
  PublicFormQuestion,
  PublicRespondent,
  RespondentInput,
} from "../shared/callables";
import { juryTargetOf } from "../shared/events";
import { activeQuestions, answerKey, isJuryForm, isPerTarget, isProvenIdentity, needsAccount, parseAnswerKey, scopeOf } from "../shared/types";
import type {
  Attendance,
  Batch,
  BatchMembership,
  ClosedList,
  EventTeam,
  FieldWrite,
  Form,
  FormAnswer,
  FormCompletion,
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
import { assertJuryKey, judgeChoices, loadJury, resolveJudge, targetsFor, type JudgeOption } from "./jury";
import { loadEvent, scoredTargets, type ScoredTarget } from "./events";
import { uiCaller, type Caller } from "../api/caller";
import { founderIdIn, loadAccount } from "../api/viewer";
import { writeAudit, writeUiAudit } from "./audit";
import { cleanId, cleanText, cleanUrl, invalidArgument } from "./clean";
import { planFieldWrites, type FieldChange } from "./fields";
import { plain } from "./operations";
import { parisMonday } from "../shared/dates";
import { formState } from "../shared/forms";
import { absentFounderIds } from "../shared/attendance";

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
//
// Le modele standard (SPECS §2) : une question a une PORTEE. « Son equipe »
// ecrit la soumission de l'equipe publiee du repondant ; « chaque coequipier »
// et « chaque equipe notee » se repetent par cible (reponse sous
// `answerKey(question, cible)`), et chaque cible ecrit son document (avis entre
// pairs, note du jury). Les cibles, c'est le SERVEUR qui les calcule (equipe
// publiee, equipes sauf la sienne) : le repondant ne choisit ni son equipe ni
// qui il note. Identites : nom choisi, compte (`account`), lien de jury
// (`jury_link`, services/jury.ts), anonyme. Une identite prouvee (compte, lien
// de jury, ou fondateur connecte) retrouve ses reponses (`prefill`) et les
// corrige en renvoyant le formulaire.

const db = () => getFirestore();

/** Tire une fois par ouverture de la page (`crypto.randomUUID`). */
const SUBMISSION_ID = /^[A-Za-z0-9-]{16,64}$/;

const NOT_OPEN: Record<Exclude<PublicForm["state"], "open">, string> = {
  closed: "This form is closed.",
  not_open_yet: "This form is not open yet.",
  draft: "This form is a draft: publish it to collect answers.",
};


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

// ---- Le repondant et ce dont parlent ses questions ------------------------------

/** Qui repond : un fondateur (nom choisi ou compte), un jure (lien de jury), ou personne (anonyme). */
type Respondent = {
  founderId: string | null;
  founder: Founder | null;
  judge: JudgeOption | null;
  label: string;
};

const founderRespondent = (founderId: string, founder: Founder): Respondent => ({
  founderId,
  founder,
  judge: null,
  label: publicShortName(founder.name),
});

/** Un jure ; un fondateur du batch qui note reste ce fondateur (il ne note pas sa propre equipe). */
const judgeRespondent = (judge: JudgeOption): Respondent => ({ founderId: judge.founderId, founder: null, judge, label: judge.name });

const toPublicRespondent = (r: Respondent): PublicRespondent => ({ founderId: r.founderId, judgeId: r.judge?.id ?? null, label: r.label });

/** Ce dont parlent les questions a portee : l'evenement, l'equipe publiee du repondant, les cibles. */
type ScopeContext = {
  event: PioneersEvent | null;
  team: (Pick<EventTeam, "name" | "memberIds" | "memberNames"> & { id: string }) | null;
  targets: Record<"each_teammate" | "each_target", PublicChoice[]>;
};

const emptyContext = (event: PioneersEvent | null): ScopeContext => ({ event, team: null, targets: { each_teammate: [], each_target: [] } });

/** L'equipe publiee de ce fondateur a cet evenement, ou `null`. */
async function teamOf(tx: Transaction | null, eventId: string, founderId: string): Promise<ScopeContext["team"]> {
  const query = db().collection(eventCollectionPaths.teams(eventId)).where("memberIds", "array-contains", founderId);
  const snap = tx ? await tx.get(query) : await query.get();
  const published = snap.docs.find((d) => (d.data() as EventTeam).publishedDateISOString !== null);
  if (!published) return null;
  const t = published.data() as EventTeam;
  return { id: published.id, name: t.name, memberIds: t.memberIds, memberNames: t.memberNames ?? null };
}

/**
 * Les noms courts des membres d'equipes : ceux de la page publique de l'equipe
 * (`memberNames`), sinon tires des fiches (equipe publiee avant les noms courts).
 */
async function memberShortNames(tx: Transaction | null, teams: Pick<EventTeam, "memberIds" | "memberNames">[]): Promise<Map<string, string>> {
  const names = new Map(teams.flatMap((t) => t.memberIds.map((id, i) => [id, t.memberNames?.[i] ?? ""] as const)));
  const missing = [...names].flatMap(([id, name]) => (name ? [] : [id]));
  if (missing.length) {
    const refs = missing.map((id) => db().doc(docPaths.founder(id)));
    // Le nom seul : les fiches portent des vignettes en `data:` URL.
    const read = { fieldMask: ["name"] };
    for (const snap of await (tx ? tx.getAll(...refs, read) : db().getAll(...refs, read))) {
      names.set(snap.id, publicShortName((snap.data() as Founder | undefined)?.name ?? ""));
    }
  }
  return names;
}

/** Les coequipiers, en nom court. */
async function teammateChoices(tx: Transaction | null, team: NonNullable<ScopeContext["team"]>, founderId: string): Promise<PublicChoice[]> {
  const names = await memberShortNames(tx, [team]);
  return team.memberIds.filter((id) => id !== founderId).map((id) => ({ value: id, label: names.get(id) || "Teammate", hint: null }));
}

/**
 * L'equipe du repondant et les cibles de ses questions. `scored` : les equipes
 * (ou startups) notees de l'evenement, si deja lues (jury).
 */
async function scopeContext(
  tx: Transaction | null,
  form: Form,
  event: PioneersEvent | null,
  respondent: Respondent,
  scored: ScoredTarget[] | null,
): Promise<ScopeContext> {
  const ctx = emptyContext(event);
  if (!event || !form.eventId) return ctx;
  const scopes = new Set(activeQuestions(form).map(scopeOf));
  const wantsTeam = scopes.has("team") || scopes.has("each_teammate") || form.attachments.team?.from === "respondent_team";
  if (respondent.founderId && wantsTeam) ctx.team = await teamOf(tx, form.eventId, respondent.founderId);
  if (ctx.team && scopes.has("each_teammate")) ctx.targets.each_teammate = await teammateChoices(tx, ctx.team, respondent.founderId!);
  const target = juryTargetOf(event);
  if (scopes.has("each_target")) {
    const all = targetsFor(scored ?? (await scoredTargets(tx, form.eventId, event)), respondent.founderId);
    // Une equipe se reconnait a ses membres ; une startup a son nom.
    const names = target === "team" ? await memberShortNames(tx, all) : new Map<string, string>();
    ctx.targets.each_target = all.map((t) => ({ value: t.id, label: t.name, hint: t.memberIds.map((id) => names.get(id)).filter(Boolean).join(", ") || null }));
  }
  return ctx;
}

/** Les cibles d'une question : les siennes pour une question par cible, une seule « sans cible » sinon. */
const targetIdsOf = (q: FormQuestion, ctx: ScopeContext): (string | null)[] => {
  const scope = scopeOf(q);
  return isPerTarget(scope) ? ctx.targets[scope].map((t) => t.value) : [null];
};

/** Les ids des sujets, d'apres le rattachement fixe par le staff (`Form.attachments`), hors cible. */
function resolveSubjects(form: Form, respondent: Respondent | null, answers: Map<string, FormAnswer>, nowISO: string, ctx: ScopeContext): ResolvedSubjects {
  const idFrom = (subject: SubjectKey, source: SubjectSource): string | null => {
    switch (source.from) {
      case "respondent":
        if (subject === "person") return respondent?.founder?.personId ?? null;
        if (subject === "judge") return respondent?.judge?.id ?? null;
        return respondent?.founderId ?? null;
      case "respondent_startup":
        return respondent?.founder?.startupId ?? null;
      case "respondent_team":
        return ctx.team?.id ?? null;
      case "fixed":
        return source.id;
      case "question": {
        const answer = answers.get(source.questionId);
        return (Array.isArray(answer) ? answer[0] : typeof answer === "string" ? answer : null) ?? null;
      }
      case "form_event":
        return form.eventId;
      // Un formulaire par occurrence : sa semaine est celle ou il ouvre, pas celle de
      // la reponse (un update rendu le lundi reste dans sa semaine).
      case "submission_week":
        return parisMonday(form.opensDateISOString ?? nowISO);
      // Pose par cible, au moment d'ecrire (`targetId`).
      case "target":
        return null;
    }
  };
  const subjects: ResolvedSubjects = {};
  for (const [subject, source] of Object.entries(form.attachments) as [SubjectKey, SubjectSource][]) {
    const id = idFrom(subject, source);
    if (id) subjects[SUBJECT_INPUT_KEY[subject]] = id;
  }
  return subjects;
}

// ---- Les reponses deja donnees (identite prouvee) -----------------------------------

/** Les valeurs en place des champs du formulaire, pour ce repondant et ses cibles, a la forme des reponses. */
async function readPrefill(form: Form, respondent: Respondent, ctx: ScopeContext, nowISO: string): Promise<Record<string, FormAnswer>> {
  const base = resolveSubjects(form, respondent, new Map(), nowISO, ctx);
  const reads: { key: string; path: string; field: string; q: FormQuestion }[] = [];
  for (const q of activeQuestions(form)) {
    if (!q.dbField) continue;
    const { doc, field } = parseDbField(q.dbField);
    for (const targetId of targetIdsOf(q, ctx)) {
      const resolved = resolveDocPath(doc, targetId ? { ...base, targetId } : base);
      if (resolved.ok) reads.push({ key: answerKey(q.id, targetId), path: resolved.path, field, q });
    }
  }
  if (reads.length === 0) return {};
  const paths = [...new Set(reads.map((r) => r.path))];
  const snaps = new Map((await db().getAll(...paths.map((p) => db().doc(p)))).map((d) => [d.ref.path, d]));
  const out: Record<string, FormAnswer> = {};
  for (const r of reads) {
    const snap = snaps.get(r.path);
    const value = snap?.exists ? fieldValueToAnswer(r.q, getFieldDef(r.q.dbField!).value, snap.get(r.field)) : undefined;
    if (value !== undefined) out[r.key] = value;
  }
  return out;
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

/** Le jury d'un formulaire `jury_link` : lien verifie, cibles notees, noms a choisir. */
async function juryOf(form: Form, key: unknown) {
  const [, event] = await Promise.all([assertJuryKey(form.eventId, key), loadEvent(null, form.eventId!)]);
  const target = juryTargetOf(event);
  const scored = await scoredTargets(null, form.eventId!, event);
  return { event, target, scored, names: await loadJury(form.eventId!, event, scored) };
}

/** Le fondateur choisi dans la liste, si la requete en nomme un. */
const chosenFounderId = (r: RespondentInput | null | undefined): string | null =>
  r && typeof r === "object" && "founderId" in r && typeof r.founderId === "string" && r.founderId ? cleanId(r.founderId, "respondent") : null;

export async function getPublicForm(uid: string | null, req: Partial<CallableRequest<"getPublicForm">>): Promise<PublicForm> {
  const formId = cleanId(req.formId, "formId");
  const [snap, account] = await Promise.all([db().doc(docPaths.form(formId)).get(), uid ? loadAccount(uid) : null]);
  const form = snap.exists ? (snap.data() as Form) : null;
  // Un brouillon n'existe pas pour le public ; le staff l'ouvre pour le relire.
  if (!form || form.archivedDateISOString !== null || (form.status === "draft" && !isStaffViewer(account?.viewer ?? null))) {
    throw new HttpsError("not-found", "This form does not exist or was removed.");
  }
  const isJury = isJuryForm(form);
  const viewerFounderId = account ? founderIdIn(account, form.batchId) : null;
  const chosen = isJury || form.identityCheck === "anonymous" ? null : (viewerFounderId ?? (needsAccount(form.identityCheck) ? null : chosenFounderId(req.respondent)));
  // Le jury (lien, evenement, noms), l'evenement et la fiche du repondant : en meme temps.
  const [jury, eventOfForm, founderSnap] = await Promise.all([
    isJury ? juryOf(form, req.key) : null,
    !isJury && form.eventId ? loadEvent(null, form.eventId).catch(() => null) : null,
    chosen ? db().doc(docPaths.founder(chosen)).get() : null,
  ]);
  const event = jury?.event ?? eventOfForm;

  const questions = activeQuestions(form);
  const entities = [...new Set(questions.flatMap((q) => (q.type === "entity_picker" && q.picker ? [q.picker.entity] : [])))];
  const asksFounderName = form.identityCheck === "select_name";
  const needsFounders = asksFounderName || entities.includes("founder");
  const needsStartups = needsFounders || entities.includes("startup");
  const listKeys = listKeysOf(questions);
  const others = entities.flatMap((e) => {
    const load = OTHER_PICKERS[e];
    return load ? [load(form).then((choices) => [e, choices] as const)] : [];
  });

  const [batchSnap, foundersSnap, startupsSnap, listSnaps, otherChoices, absentSnap] = await Promise.all([
    db().doc(docPaths.batch(form.batchId)).get(),
    needsFounders
      ? db().collection(COL.founders).where("batchId", "==", form.batchId).select("name", "startupId", "archivedDateISOString").get()
      : null,
    needsStartups ? db().collection(COL.startups).where("batchId", "==", form.batchId).select("name", "archivedDateISOString").get() : null,
    listKeys.length ? db().getAll(...listKeys.map((k) => db().doc(docPaths.list(k)))) : [],
    Promise.all(others),
    // Les absents de l'evenement ne sont ni proposes ni repondants (shared/attendance.ts).
    needsFounders && form.eventId ? db().collection(eventCollectionPaths.attendance(form.eventId)).select("founderId", "status").get() : null,
  ]);
  const absentIds = absentFounderIds((absentSnap?.docs ?? []).map((d) => d.data() as Pick<Attendance, "founderId" | "status">));

  const startups = (startupsSnap?.docs ?? [])
    .map((d) => ({ id: d.id, s: d.data() as Pick<Startup, "name" | "archivedDateISOString"> }))
    .filter(({ s }) => s.archivedDateISOString === null)
    .map(({ id, s }) => ({ value: id, label: s.name, hint: null }))
    .sort(byLabel);
  const startupNames = new Map(startups.map((s) => [s.value, s.label]));
  // Nom court (prenom + initiale) et startup : assez pour se reconnaitre sans exposer le nom complet.
  const founders = (foundersSnap?.docs ?? [])
    .map((d) => ({ id: d.id, f: d.data() as Pick<Founder, "name" | "startupId" | "archivedDateISOString"> }))
    .filter(({ id, f }) => f.archivedDateISOString === null && !absentIds.has(id))
    .map(({ id, f }) => ({ value: id, label: publicShortName(f.name), hint: f.startupId ? (startupNames.get(f.startupId) ?? null) : null }))
    .sort(byLabel);

  const choices: PublicForm["choices"] = Object.fromEntries(otherChoices);
  // On ne se choisit pas soi-meme (picks, « je travaille avec ») : le serveur le refuse aussi.
  if (entities.includes("founder")) choices.founder = founders.filter((f) => f.value !== viewerFounderId);
  if (entities.includes("startup")) choices.startup = startups;

  // Le repondant : le compte rattache, le nom choisi (`respondent`), ou le jure.
  const nowISO = new Date().toISOString();
  let respondent: Respondent | null = null;
  if (jury) {
    const judge = resolveJudge(req.respondent, jury.names);
    respondent = judge ? judgeRespondent(judge) : null;
  } else {
    const founder = founderSnap?.data() as Founder | undefined;
    if (founder && founder.batchId === form.batchId && founder.archivedDateISOString === null) respondent = founderRespondent(founderSnap!.id, founder);
  }
  const ctx = respondent ? await scopeContext(null, form, event, respondent, jury?.scored ?? null) : emptyContext(event);
  // Les reponses deja donnees : seulement si l'identite est prouvee (un nom choisi ne prouve rien).
  const proven = respondent !== null && (isProvenIdentity(form.identityCheck) || (respondent.founderId !== null && respondent.founderId === viewerFounderId));
  const state = formState(form, nowISO);

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
    scope: scopeOf(q),
  }));

  return {
    formId,
    version: form.version,
    kind: form.kind,
    event: event && form.eventId ? { id: form.eventId, name: event.name, programId: event.programId, batchId: event.batchId } : null,
    title: form.title,
    description: form.description,
    batchName: (batchSnap.data() as Batch | undefined)?.name ?? "",
    identityCheck: form.identityCheck,
    deadlineDateISOString: form.deadlineDateISOString,
    state,
    questions: publicQuestions,
    respondents: jury ? judgeChoices(jury.names) : asksFounderName ? founders : [],
    allowTypedName: isJury,
    choices,
    viewerFounderId,
    respondent: respondent ? toPublicRespondent(respondent) : null,
    team: ctx.team ? { id: ctx.team.id, name: ctx.team.name } : null,
    targets: ctx.targets,
    prefill: proven ? await readPrefill(form, respondent!, ctx, nowISO) : {},
    canResubmit: proven && state === "open",
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
      const scale = ratingScale(q);
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

const TARGET_WORD = { each_teammate: "teammate", each_target: "team" } as const;

/** Les reponses, par `answerKey` : une par question, ou une par cible pour une question par cible. */
function parseAnswers(questions: FormQuestion[], raw: unknown, lists: Map<string, ClosedList>, ctx: ScopeContext): Map<string, FormAnswer> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpsError("invalid-argument", "`answers` is required.");
  const input = raw as Record<string, unknown>;
  // Une reponse pour une cible que le formulaire n'offre pas (une autre equipe, sa propre equipe) est refusee.
  const offered = new Set(questions.flatMap((q) => targetIdsOf(q, ctx).map((t) => answerKey(q.id, t))));
  const stray = Object.keys(input).find((key) => parseAnswerKey(key).targetId !== null && !offered.has(key));
  if (stray) throw new HttpsError("invalid-argument", "You cannot answer for this one: it is not offered to you.");
  const answers = new Map<string, FormAnswer>();
  for (const q of questions) {
    const scope = scopeOf(q);
    for (const targetId of targetIdsOf(q, ctx)) {
      const key = answerKey(q.id, targetId);
      const value = cleanAnswer(q, input[key], lists);
      if (value !== null) answers.set(key, value);
      else if (q.required) throw invalid(q, isPerTarget(scope) ? `this question is required for each ${TARGET_WORD[scope]}.` : "this question is required.");
    }
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

/** Les objets choisis existent et appartiennent au batch du formulaire (ou a son evenement) ; on ne se choisit pas soi-meme. */
async function assertPickedExist(
  tx: Transaction,
  form: Form,
  questions: FormQuestion[],
  answers: Map<string, FormAnswer>,
  respondent: Respondent | null,
) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const checks = [...answers].flatMap(([key, answer]) => {
    const q = byId.get(parseAnswerKey(key).questionId);
    if (!q || q.type !== "entity_picker" || !q.picker) return [];
    return (answer as string[]).map((id) => {
      const picked = PICKED[q.picker!.entity];
      if (q.picker!.entity === "founder" && id === respondent?.founderId) throw invalid(q, "you cannot pick yourself.");
      const cleaned = cleanId(id, q.label);
      const path = picked.path(form, cleaned);
      if (!path) throw invalid(q, "this form is not attached to an event.");
      return { q, id: cleaned, path, ok: picked.ok };
    });
  });
  if (checks.length === 0) return;
  // Un absent de l'evenement n'est pas propose (getPublicForm) : il n'est pas accepte non plus.
  const pickedFounders = form.eventId ? checks.filter((c) => c.q.picker!.entity === "founder") : [];
  const all = await tx.getAll(...[...checks.map((c) => c.path), ...pickedFounders.map((c) => docPaths.attendance(form.eventId!, c.id))].map((p) => db().doc(p)));
  const snaps = all.slice(0, checks.length);
  const marks = all.slice(checks.length);
  snaps.forEach((snap, i) => {
    if (!snap.exists || !checks[i].ok(form, snap.data() as Doc)) throw invalid(checks[i].q, "this choice is not in the list.");
  });
  marks.forEach((mark, i) => {
    if (mark.get("status") === "absent") throw invalid(pickedFounders[i].q, "this founder was absent.");
  });
}

// ---- 2. qui repond -----------------------------------------------------------------

/**
 * Le fondateur qui repond. `select_name` : le nom choisi dans la liste (un
 * fondateur connecte du batch repond en son nom, la page ne lui demande pas de
 * choisir). `account` : le compte connecte et rattache au batch, seul.
 */
async function resolveFounder(
  tx: Transaction,
  form: Form,
  linkedId: string | null,
  chosenId: string | null,
  chosenSnap: DocumentSnapshot | null,
): Promise<Respondent> {
  if (needsAccount(form.identityCheck) && !linkedId) {
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
  return founderRespondent(founderId, founder);
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

/** Les ecritures d'un groupe de questions : celles du repondant et de son equipe, ou celles d'une cible. */
async function planWrites(
  tx: Transaction,
  form: Form,
  questions: FormQuestion[],
  answers: Map<string, FormAnswer>,
  subjects: ResolvedSubjects,
  targetId: string | null,
  actorUid: string,
  nowISO: string,
  createWith: Partial<Record<DocKind, Record<string, unknown>>> | undefined,
) {
  const writes: FieldWrite[] = [];
  const unmatched: UnmatchedAnswer[] = [];
  const unmatchedOf = (questionId: string, value: FormAnswer, reason: UnmatchedAnswer["reason"]) =>
    unmatched.push({ questionId: answerKey(questionId, targetId), value, reason, analyzedDateISOString: null });

  // Une question par champ : si deux questions visent le meme champ, la premiere ecrit.
  const byField = new Map<DbFieldKey, { q: FormQuestion; answer: FormAnswer; value: FormAnswer }>();
  for (const q of questions) {
    const answer = answers.get(answerKey(q.id, targetId));
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
  const plan = await planFieldWrites(tx, formCaller(actorUid), { subjects, values }, { partial: true, hold: needsApproval, asForm: true, createWith });

  const pathOf = (key: DbFieldKey) => {
    const resolved = resolveDocPath(parseDbField(key).doc, subjects);
    return resolved.ok ? resolved.path : "";
  };
  const write = (key: DbFieldKey, entry: Pick<FieldWrite, "value" | "previousValue" | "status" | "reason">): FieldWrite => ({
    questionId: byField.get(key)!.q.id,
    targetId,
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

/** Les groupes d'ecriture : le repondant et son equipe, puis chaque cible repondue. */
function writeGroups(questions: FormQuestion[], answers: Map<string, FormAnswer>, ctx: ScopeContext) {
  const groups: { targetId: string | null; questions: FormQuestion[] }[] = [{ targetId: null, questions: questions.filter((q) => !isPerTarget(scopeOf(q))) }];
  for (const scope of ["each_teammate", "each_target"] as const) {
    const asked = questions.filter((q) => scopeOf(q) === scope);
    for (const t of ctx.targets[scope]) {
      const answered = asked.filter((q) => answers.has(answerKey(q.id, t.value)));
      if (answered.length) groups.push({ targetId: t.value, questions: answered });
    }
  }
  return groups;
}

// ---- submitFormResponse ----------------------------------------------------------

export async function submitFormResponse(
  uid: string | null,
  req: Partial<CallableRequest<"submitFormResponse">>,
): Promise<CallableResponse<"submitFormResponse">> {
  const formId = cleanId(req.formId, "formId");
  const submissionId = String(req.submissionId ?? "");
  if (!SUBMISSION_ID.test(submissionId)) throw new HttpsError("invalid-argument", "`submissionId` is required.");
  const chosenId = chosenFounderId(req.respondent);
  // Id deterministe : un second envoi de la meme ouverture retombe sur la meme reponse.
  const responseRef = db().collection(COL.formResponses).doc(`${formId}_${submissionId}`);
  const formRef = db().doc(docPaths.form(formId));

  // Un jury (la requete porte le secret du lien) : le lien et les noms se lisent
  // avant la transaction (des collections entieres), comme le jure les a vus.
  const before = req.key ? ((await formRef.get()).data() as Form | undefined) : undefined;
  const jury = before && isJuryForm(before) && before.archivedDateISOString === null ? await juryOf(before, req.key) : null;
  const judge = jury ? resolveJudge(req.respondent, jury.names) : null;
  if (jury && !judge) throw new HttpsError("invalid-argument", "Choose or type your name first.");

  return db().runTransaction(async (tx) => {
    const [formSnap, existing] = await tx.getAll(formRef, responseRef);
    if (existing.exists) return { responseId: existing.id, status: (existing.data() as FormResponse).status };

    const form = formSnap.data() as Form | undefined;
    if (!form || form.archivedDateISOString !== null) throw new HttpsError("not-found", "This form does not exist or was removed.");
    if (isJuryForm(form) && !jury) throw new HttpsError("permission-denied", "This jury link is not valid any more. Ask the Pioneers team for the new one.");
    if (!isJuryForm(form) && jury) {
      throw new HttpsError("failed-precondition", "This form was updated since you opened it. Reload the page to see the new version.");
    }
    const nowISO = new Date().toISOString();
    const state = formState(form, nowISO);
    if (state !== "open") throw new HttpsError("failed-precondition", jury && state === "closed" ? "Scores are locked." : NOT_OPEN[state]);
    if (req.version !== form.version) {
      throw new HttpsError("failed-precondition", "This form was updated since you opened it. Reload the page to see the new version.");
    }

    // UNE lecture : les listes des questions a choix, le rattachement du compte, le nom choisi, l'evenement.
    const questions = activeQuestions(form);
    const listKeys = listKeysOf(questions);
    const asksFounder = !jury && form.identityCheck !== "anonymous";
    const membershipPath = uid && asksFounder ? docPaths.membership(form.batchId, uid) : null;
    const chosenPath = asksFounder && chosenId && !needsAccount(form.identityCheck) ? docPaths.founder(chosenId) : null;
    const eventPath = !jury && form.eventId ? docPaths.event(form.eventId) : null;
    const paths = [...listKeys.map(docPaths.list), ...[membershipPath, chosenPath, eventPath].filter((p): p is string => p !== null)];
    const snaps = new Map((paths.length ? await tx.getAll(...paths.map((p) => db().doc(p))) : []).map((d) => [d.ref.path, d]));
    const lists = listsFrom(listKeys.map((k) => snaps.get(docPaths.list(k))!));
    const event = jury?.event ?? ((eventPath ? snaps.get(eventPath)?.data() : undefined) as PioneersEvent | undefined) ?? null;

    const linkedId = membershipPath ? ((snaps.get(membershipPath)?.data() as BatchMembership | undefined)?.founderId ?? null) : null;
    const respondent = judge
      ? judgeRespondent(judge)
      : asksFounder
        ? await resolveFounder(tx, form, linkedId, chosenPath ? chosenId : null, chosenPath ? snaps.get(chosenPath)! : null)
        : null;
    const ctx = respondent ? await scopeContext(tx, form, event, respondent, jury?.scored ?? null) : emptyContext(event);
    if (formNeedsTeam(form) && !ctx.team) throw new HttpsError("failed-precondition", "You were not in a published team at this event.");

    const answers = parseAnswers(questions, req.answers, lists, ctx);
    await assertPickedExist(tx, form, questions, answers, respondent);

    const subjects = resolveSubjects(form, respondent, answers, nowISO, ctx);
    const actorUid = uid ?? (judge ? `jury:${judge.id}` : `form:${formId}`);
    // Une note du jury nait avec le nom du jure et ce qu'il note.
    const createWith = judge && jury ? { evaluation: { evaluatorName: judge.name, isExternal: judge.founderId === null, targetType: jury.target } } : undefined;
    // Chaque groupe lit ses documents ; toutes les lectures partent ensemble, avant toute ecriture.
    const planned = await Promise.all(
      writeGroups(questions, answers, ctx).map((g) =>
        planWrites(tx, form, g.questions, answers, g.targetId ? { ...subjects, targetId: g.targetId } : subjects, g.targetId, actorUid, nowISO, createWith),
      ),
    );
    const writes = planned.flatMap((p) => p.writes);
    const unmatched = planned.flatMap((p) => p.unmatched);

    // Toutes les lectures sont faites : on ecrit.
    for (const p of planned) p.commit?.(tx);
    const answeredTargets = new Set([...answers.keys()].flatMap((k) => parseAnswerKey(k).targetId ?? []));
    const targetNames = Object.fromEntries(
      [...ctx.targets.each_teammate, ...ctx.targets.each_target].filter((t) => answeredTargets.has(t.value)).map((t) => [t.value, t.label]),
    );
    const response: FormResponse = {
      programId: form.programId,
      batchId: form.batchId,
      formId,
      formKind: form.kind,
      formVersion: form.version,
      respondentPersonId: respondent?.founder?.personId ?? null,
      respondentFounderId: respondent?.founderId ?? null,
      respondentJudgeId: judge?.id ?? null,
      respondentName: respondent?.label ?? null,
      subjects,
      answers: Object.fromEntries(answers),
      ...(Object.keys(targetNames).length ? { targetNames } : {}),
      writes,
      unmatched,
      status: responseStatus(writes),
      submittedDateISOString: nowISO,
    };
    tx.create(responseRef, plain(response));
    // Le « To do » du fondateur (qui ne lit pas `formResponses`). Un formulaire
    // anonyme n'a pas de repondant : rien ne le rattache au fondateur. Un jury
    // n'est le « To do » de personne.
    if (respondent?.founderId && !judge) {
      const completion: FormCompletion = {
        programId: form.programId,
        batchId: form.batchId,
        formId,
        founderId: respondent.founderId,
        formKind: form.kind,
        responseId: responseRef.id,
        completedDateISOString: nowISO,
      };
      tx.set(db().doc(docPaths.formCompletion(formId, respondent.founderId)), completion);
    }
    writeAudit(tx, formCaller(actorUid), {
      action: "submit_form_response",
      targetPath: responseRef.path,
      idempotencyKey: null,
      payload: {
        formId,
        formVersion: form.version,
        ...(judge ? { judgeId: judge.id, judgeName: judge.name } : {}),
        applied: writes.filter((w) => w.status === "applied").map((w) => w.dbField),
        pending: writes.filter((w) => w.status === "pending_approval").map((w) => w.dbField),
      },
    });
    return { responseId: responseRef.id, status: response.status };
  });
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
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) throw invalidArgument("writeIndex", "required.");
  const ref = db().collection(COL.formResponses).doc(responseId);
  // Le staff qui valide ecrit avec ses propres droits (son compte, pas l'autorite du formulaire).
  const staff = await uiCaller(staffUid);

  return db().runTransaction(async (tx) => {
    const response = (await tx.get(ref)).data() as FormResponse | undefined;
    const write = response?.writes[index];
    if (!response || !write) throw new HttpsError("not-found", "No such answer.");
    if (write.status !== "pending_approval") throw new HttpsError("failed-precondition", "This value was already decided.");

    let status: FieldWrite["status"] = "rejected";
    if (req.approve === true) {
      try {
        // Une valeur d'une cible (avis, note du jury) s'ecrit avec sa cible, et comme son formulaire l'aurait fait.
        const subjects = write.targetId ? { ...response.subjects, targetId: write.targetId } : response.subjects;
        const plan = await planFieldWrites(tx, staff, { subjects, values: { [write.dbField]: write.value } }, { asForm: isFormOnly(parseDbField(write.dbField).doc) });
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
