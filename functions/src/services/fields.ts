import { getFirestore, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { docPaths } from "../shared/collections";
import {
  DB_FIELDS,
  DOC_KINDS,
  enumOptions,
  FIELD_FAMILIES,
  getFieldDef,
  isDbFieldKey,
  isEmptyValue,
  isFormOnly,
  isListValue,
  listKeyOf,
  parseDbField,
  PERSON_COPIES,
  resolveDocPath,
  stampOf,
  SUBJECT_INPUT_KEY,
  type DbFieldKey,
  type DocKind,
  type FieldDef,
  type ResolvedSubjects,
  type SubjectKey,
  type TrackingDocKind,
  type ValueSpec,
} from "../shared/fieldRegistry";
import { emptySubmission, type ClosedList, type FormAnswer, type Founder, type Person, type Startup } from "../shared/types";
import { isSelfEditable, isStaffViewer, isViewerFounder } from "../shared/access";
import type { Caller } from "../api/caller";
import { ApiError, badRequest, forbidden, notFound } from "../api/errors";
import { founderIdIn } from "../api/viewer";
import { normalizeHttpUrl } from "../shared/text";
import type { Operation, OperationPlan } from "./operations";
import { dayString } from "./schemas";

// ----------------------------
// services - ecrire des CHAMPS du registre
// ----------------------------
// LE geste d'ecriture generique : une liste d'adresses `dbField`
// (`startupProfile.icp`, `checkin.totalAmountPaid`, `person.linkedinUrl`) et leurs
// valeurs, pour un ensemble de sujets (fondateur, startup, semaine, evenement,
// equipe). C'est le REGISTRE (shared/fieldRegistry.ts) qui decide : valeur
// acceptee, regle d'ecriture (`fill_empty`, `overwrite`, `merge_unique`), cycle
// de vie du document (`DOC_KINDS[kind].lifecycle`), copies (`PERSON_COPIES`).
//
// Garde-fous :
//   - AUCUNE VALEUR VIDE. Vider un champ, c'est supprimer une donnee : Claude ne
//     supprime rien (SPECS §4.8), et une integration non plus. Cela se fait
//     dans l'interface.
//   - Tout ou rien : une valeur invalide refuse toute l'ecriture, avec le champ
//     fautif nomme. Un import partiel est pire qu'un refus clair.
//   - Les documents de base (personne, fondateur, startup, evenement, equipe)
//     doivent exister ; les documents de suivi se creent a la demande.
//   - Les COPIES suivent l'original, dans la meme transaction.
//   - Les documents « formulaire seulement » (avis entre pairs, picks, notes du
//     jury) ne s'ecrivent que par leur formulaire (`asForm`), qui a verifie la cible.
//   - Une famille (`submission.metrics.<cle>`) s'ecrit en champ imbrique.
//
// Toutes les lectures partent en UN aller-retour (`tx.getAll`), plus un second
// pour les fondateurs d'une personne quand une copie est en jeu : l'operation
// est planifiee deux fois par le MCP (apercu, confirmation).

const FIELD_KEYS = Object.keys(DB_FIELDS) as (keyof typeof DB_FIELDS)[];

export const SetFieldsInput = z
  .object({
    subjects: z
      .object({
        personId: z.string().min(1),
        founderId: z.string().min(1),
        startupId: z.string().min(1),
        eventId: z.string().min(1),
        weekStartDayString: dayString.describe("Monday of the week, YYYY-MM-DD."),
        teamId: z.string().min(1),
        targetId: z.string().min(1),
        judgeId: z.string().min(1),
      } satisfies Record<keyof ResolvedSubjects, z.ZodType>)
      .partial()
      .strict()
      .describe("Ids of what the fields belong to. Each field says which ones it needs (list `fields`)."),
    // Les cles ne sont PAS un enum dans le schema : la centaine d'adresses du
    // registre couterait ~600 jetons a chaque tour du MCP. Elles sont verifiees
    // a l'appel, avec les adresses proches dans le refus (`knownFields`).
    values: z
      .record(z.string(), z.unknown())
      .refine((v) => Object.keys(v).length > 0, "at least one field")
      .refine((v) => Object.keys(v).length <= 60, "at most 60 fields per call")
      .describe('Field address -> value, e.g. {"startupProfile.icp": "...", "checkin.totalAmountPaid": 1200}.'),
  })
  .strict();
export type SetFieldsInput = z.output<typeof SetFieldsInput>;

// ---- Le registre, lu une fois au chargement ---------------------------------------

// « linkedin.com/in/ada » est complete en `https://...` avant validation (shared/text.ts).
const httpUrl = z.preprocess((v) => (typeof v === "string" ? (normalizeHttpUrl(v) ?? v) : v), z.url({ protocol: /^https?$/ }));
const notEmpty = "empty values are not written";

function valueSchema(spec: ValueSpec): z.ZodType {
  switch (spec.kind) {
    case "text": {
      const s = z.string().trim().min(1, notEmpty);
      return spec.maxLength ? s.max(spec.maxLength) : s;
    }
    case "textList": {
      const a = z.array(z.string().trim().min(1).max(300)).min(1, notEmpty);
      return spec.maxItems ? a.max(spec.maxItems) : a;
    }
    case "number": {
      let n = z.number();
      if (spec.integer) n = n.int();
      if (spec.min !== null) n = n.min(spec.min);
      if (spec.max !== null) n = n.max(spec.max);
      return n;
    }
    case "rating":
      return z.number().int().min(spec.min).max(spec.max);
    case "boolean":
      return z.boolean();
    case "day":
      return dayString;
    case "url":
      return httpUrl;
    case "email":
      return z.email().transform((e) => e.toLowerCase());
    case "phone":
      return z.string().trim().regex(/^\+?[0-9 ().-]{6,24}$/, "expected a phone number, e.g. +33 6 12 34 56 78");
    case "enum":
      return z.string().trim().min(1);
    case "enumMulti":
      return z.array(z.string().trim().min(1)).min(1, notEmpty);
    case "founderRefs": {
      const a = z.array(z.string().min(1)).min(1, notEmpty);
      return spec.maxItems ? a.max(spec.maxItems) : a;
    }
    case "files":
      return spec.multiple ? z.array(httpUrl).min(1, notEmpty) : httpUrl;
  }
}

type FieldMeta = { key: DbFieldKey; kind: DocKind; field: string; def: FieldDef; schema: z.ZodType };

const metaFor = (key: DbFieldKey): FieldMeta => {
  const { doc: kind, field } = parseDbField(key);
  const def = getFieldDef(key);
  return { key, kind, field, def, schema: valueSchema(def.value) };
};

const META = new Map<DbFieldKey, FieldMeta>(FIELD_KEYS.map((key) => [key, metaFor(key)]));

/** Le champ d'une adresse : du registre, ou d'une famille (calcule a la demande, puis garde). */
function metaOf(key: DbFieldKey): FieldMeta {
  let meta = META.get(key);
  if (!meta) META.set(key, (meta = metaFor(key)));
  return meta;
}

/** Valeurs par defaut d'un document de suivi cree par une ecriture : `[]` pour une liste, `null` sinon. */
const DEFAULTS_BY_KIND = new Map<DocKind, Record<string, FormAnswer>>();
for (const key of FIELD_KEYS) {
  const m = metaOf(key);
  DEFAULTS_BY_KIND.set(m.kind, { ...DEFAULTS_BY_KIND.get(m.kind), [m.field]: isListValue(m.def.value) ? [] : null });
}

/** Les champs-familles de chaque document (`submission` -> `metrics`) : imbriques, ils fusionnent avec la base. */
const FAMILY_HEADS = new Map<DocKind, string[]>();
for (const family of Object.keys(FIELD_FAMILIES) as (keyof typeof FIELD_FAMILIES)[]) {
  const { doc, field } = parseDbField(`${family}.x`);
  FAMILY_HEADS.set(doc, [...(FAMILY_HEADS.get(doc) ?? []), field.split(".")[0]]);
}

/** `{ "metrics.calls": 3 }` -> `{ metrics: { calls: 3 } }` : un champ de famille est imbrique (un `set` ne lit pas les points). */
function nest(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(patch)) {
    const dot = path.indexOf(".");
    if (dot < 0) out[path] = value;
    else {
      const head = path.slice(0, dot);
      out[head] = { ...(out[head] as Record<string, unknown> | undefined), [path.slice(dot + 1)]: value };
    }
  }
  return out;
}

const PERSON_COPY_ENTRIES = Object.entries(PERSON_COPIES).map(([copy, source]) => {
  const { doc: kind, field } = parseDbField(copy as DbFieldKey);
  return { kind: kind as "founder" | "founderDirectory", field, source: source as keyof Person };
});
/** Champs de `people` dont l'ecriture touche les fondateurs (copies, et le nom affiche derive). */
const PERSON_FIELDS_WITH_COPIES = new Set<string>([...PERSON_COPY_ENTRIES.map((c) => c.source), "firstName", "lastName"]);

// ---- Les etapes du plan ---------------------------------------------------------

type Loaded = { person: Person | null; founder: Founder | null; startup: Startup | null; eventBatchId: string | null };

export type FieldChange = { dbField: DbFieldKey; before: unknown; after: unknown; status: "write" | "unchanged"; reason?: string };

/** 0. Chaque adresse existe dans le registre ; sinon, les plus proches. */
function knownFields(values: Record<string, unknown>): FieldMeta[] {
  return Object.keys(values).map((raw) => {
    if (isDbFieldKey(raw)) return metaOf(raw);
    const [doc = "", field = ""] = raw.split(".");
    const near = FIELD_KEYS.filter((k) => k.startsWith(`${doc}.`) || k.toLowerCase().endsWith(`.${field.toLowerCase()}`)).slice(0, 8);
    throw badRequest(
      "unknown_field",
      `\`${raw}\` is not a writable field.${near.length ? ` Closest: ${near.join(", ")}.` : ""} The full list: list \`fields\`.`,
      `values.${raw}`,
    );
  });
}

/** 1. Le chemin d'un document, ou l'id qui manque pour le trouver. */
function resolvePath(kind: DocKind, s: ResolvedSubjects): string {
  const resolved = resolveDocPath(kind, s);
  if (resolved.ok) return resolved.path;
  const names = resolved.missing.map((m) => SUBJECT_INPUT_KEY[m]);
  throw badRequest("missing_subject", `Fields of \`${kind}\` need \`subjects.${names.join("`, `subjects.")}\`.`, `subjects.${names[0]}`);
}

function assertMonday(day: string) {
  if (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) {
    throw badRequest("invalid_week", "`weekStartDayString` must be the Monday of the week.", "subjects.weekStartDayString");
  }
}

/** 2. Une valeur, validee par le registre (sans lecture). */
function parseValue({ key, schema }: FieldMeta, raw: unknown): FormAnswer {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("invalid_value", `\`${key}\`: ${parsed.error.issues[0]?.message ?? "invalid value"}`, `values.${key}`);
  }
  return parsed.data as FormAnswer;
}

/** Les documents de base que les sujets nomment, et leur refus s'ils n'existent pas. */
const BASE_DOCS: { subject: SubjectKey; path: (s: ResolvedSubjects) => string | null; code: string; label: string }[] = [
  { subject: "person", path: (s) => (s.personId ? docPaths.person(s.personId) : null), code: "person_not_found", label: "Person" },
  { subject: "founder", path: (s) => (s.founderId ? docPaths.founder(s.founderId) : null), code: "founder_not_found", label: "Founder" },
  { subject: "startup", path: (s) => (s.startupId ? docPaths.startup(s.startupId) : null), code: "startup_not_found", label: "Startup" },
  { subject: "event", path: (s) => (s.eventId ? docPaths.event(s.eventId) : null), code: "event_not_found", label: "Event" },
  { subject: "team", path: (s) => (s.eventId && s.teamId ? docPaths.team(s.eventId, s.teamId) : null), code: "team_not_found", label: "Team" },
];

/** 3. Une valeur de liste (fermee ou fixe) se reconnait par sa cle ou son libelle, sans casse. */
function normalizeEnum({ key, def }: FieldMeta, value: FormAnswer, lists: Map<string, ClosedList>): FormAnswer {
  const allowed = enumOptions(def.value, lists);
  if (!allowed) return value;
  const normalize = (raw: string) => {
    const lower = raw.toLowerCase();
    const hit = allowed.find((a) => a.value.toLowerCase() === lower || a.label.toLowerCase() === lower);
    if (hit) return hit.value;
    const sample = allowed.slice(0, 15).map((a) => a.value).join(", ");
    throw badRequest("invalid_value", `\`${key}\`: unknown value "${raw}". Accepted: ${sample}${allowed.length > 15 ? ", ..." : ""}.`, `values.${key}`);
  };
  return Array.isArray(value) ? [...new Set(value.map(normalize))] : normalize(value as string);
}

/** 4. Ce qui change, champ par champ, selon la regle d'ecriture du registre. */
function diff(
  fields: FieldMeta[],
  values: Map<DbFieldKey, FormAnswer>,
  targets: Map<DocKind, DocumentSnapshot>,
  hold: ((change: FieldChange) => boolean) | undefined,
) {
  const changes: FieldChange[] = [];
  const patches = new Map<DocKind, Record<string, unknown>>();
  for (const { key, kind, field, def } of fields) {
    const current = targets.get(kind)!.get(field) as unknown;
    const incoming = values.get(key);
    let after: unknown = incoming;
    let reason: string | undefined;

    if (def.writePolicy === "fill_empty" && !isEmptyValue(current)) {
      reason = "already filled (this field is only written when empty)";
      after = current;
    } else if (def.writePolicy === "merge_unique" && Array.isArray(incoming)) {
      const base = Array.isArray(current) ? (current as unknown[]) : [];
      after = [...base, ...incoming.filter((v) => !base.includes(v))];
    }
    if (!reason && JSON.stringify(current ?? null) === JSON.stringify(after ?? null)) reason = "same value";

    const change: FieldChange = { dbField: key, before: current ?? null, after, status: reason ? "unchanged" : "write", ...(reason ? { reason } : {}) };
    changes.push(change);
    if (!reason && !hold?.(change)) patches.set(kind, { ...patches.get(kind), [field]: after });
  }
  return { changes, patches };
}

/**
 * QUI ECRIT QUOI, miroir des regles `update` : le staff ecrit tout ; un
 * fondateur ne change que les champs de « Mon profil » (`FOUNDER_SELF_EDITABLE`)
 * de SA fiche et de SA personne. Le reste (updates, presences, startups) est
 * ecrit par le staff, comme dans l'app. Deux temps : le champ (sans lecture),
 * puis la propriete (une fois les documents lus).
 */
/** Avis entre pairs, picks, notes du jury : seulement par leur formulaire, qui a verifie la cible. */
function assertNotFormOnly(fields: FieldMeta[]) {
  const formOnly = fields.find(({ kind }) => isFormOnly(kind));
  if (formOnly) throw forbidden("form_only", `\`${formOnly.key}\` is private: it is only written by its form in the hub.`);
}

function assertSelfEditableFields(caller: Caller, fields: FieldMeta[]) {
  if (isStaffViewer(caller.viewer)) return;
  const staffOnly = fields.find(({ kind, field }) => !isSelfEditable(kind, field));
  if (staffOnly) {
    throw forbidden("not_allowed", `\`${staffOnly.key}\` is written by the Pioneers staff. You can change the fields of your own profile.`);
  }
}

function assertOwnsSubjects(caller: Caller, fields: FieldMeta[], s: ResolvedSubjects, loaded: Loaded) {
  if (isStaffViewer(caller.viewer)) return;
  const ownsPerson = loaded.person !== null && loaded.person.uid === caller.uid;
  const ownsFounder = loaded.founder !== null && isViewerFounder(founderIdIn(caller, loaded.founder.batchId), s.founderId ?? "");
  const foreign = fields.find(({ kind }) => !(kind === "person" ? ownsPerson : ownsFounder));
  if (foreign) throw forbidden("not_allowed", `You can only change your own profile, not this one (\`${foreign.key}\`).`);
}

/** Champs de structure d'un document de suivi cree par l'ecriture (le reste : valeurs par defaut du registre). */
const TRACKING_BASE: Record<TrackingDocKind, (s: ResolvedSubjects, l: Loaded) => Record<string, unknown>> = {
  founderWeek: (s, l) => ({
    programId: l.founder!.programId,
    batchId: l.founder!.batchId,
    founderId: s.founderId,
    weekStartDayString: s.weekStartDayString,
    programWeek: null,
  }),
  checkin: (s, l) => ({
    programId: l.startup!.programId,
    batchId: l.startup!.batchId,
    startupId: s.startupId,
    memberIds: l.startup!.memberIds,
    founderId: s.founderId,
    weekStartDayString: s.weekStartDayString,
  }),
  attendance: (s) => ({ founderId: s.founderId }),
  sessionRating: (s, l) => ({
    programId: l.founder!.programId,
    batchId: l.founder!.batchId,
    eventId: s.eventId,
    founderId: s.founderId,
    rating: null,
    comment: null,
    submittedDateISOString: new Date().toISOString(),
  }),
  submission: (s) => emptySubmission(s.teamId!),
  picks: (s, l) => ({
    programId: l.founder!.programId,
    batchId: l.founder!.batchId,
    eventId: s.eventId,
    founderId: s.founderId,
    pickedFounderIds: [],
  }),
  peerRating: (s, l) => ({
    programId: l.founder!.programId,
    batchId: l.founder!.batchId,
    raterFounderId: s.founderId,
    rateeFounderId: s.targetId,
    teamId: s.teamId,
    rating: null,
    comment: null,
  }),
  evaluation: (s) => ({
    evaluatorKind: "judge",
    evaluatorId: s.judgeId,
    evaluatorName: "",
    isExternal: true,
    targetType: "team",
    targetId: s.targetId,
    scores: {},
    overallScore: null,
    wouldInvest: null,
    betLikelihood: null,
    wantsToContinue: null,
    comment: null,
    decision: null,
    finalDecision: null,
  }),
};

/** 5. Les copies de `people` vers les fondateurs de la personne. */
function personCopies(person: Person, personPatch: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...personPatch };
  // Le nom affiche ne suit le prenom et le nom que s'il etait celui par defaut.
  if (("firstName" in next || "lastName" in next) && person.displayName === `${person.firstName} ${person.lastName}`.trim()) {
    next.displayName = `${(next.firstName as string) ?? person.firstName} ${(next.lastName as string) ?? person.lastName}`.trim();
  }
  const copies: Record<"founder" | "founderDirectory", Record<string, unknown>> = { founder: {}, founderDirectory: {} };
  for (const c of PERSON_COPY_ENTRIES) if (c.source in next) copies[c.kind][c.field] = next[c.source];
  // La grande photo (Storage, ecrite par l'import) montrait l'ancienne photo :
  // on l'efface, la carte de l'annuaire retombe sur la nouvelle `photoUrl`.
  if ("photoUrl" in next) copies.founder.coverPhotoUrl = null;
  return { displayName: next.displayName as string | undefined, copies };
}

// ---- L'operation -----------------------------------------------------------------

export type SetFieldsResult = { written: number; unchanged: number; paths: string[] };

/** Un champ ecarte en mode partiel. `subject` : son sujet manque, est introuvable ou ne colle pas (membre, batch). */
export type FieldRejection = { dbField: DbFieldKey; message: string; subject: boolean };

export type FieldWritesOptions = {
  /**
   * Ecarter les champs fautifs (`rejected`) au lieu de refuser tout l'appel :
   * une reponse de formulaire garde ce qui est valide. L'API et le MCP restent
   * en « tout ou rien ». Les refus de droits levent toujours.
   */
  partial?: boolean;
  /** Changements calcules (dans `changes`) mais pas ecrits : en attente de validation du staff. */
  hold?: (change: FieldChange) => boolean;
  /**
   * Ecriture d'une reponse de formulaire : le formulaire, cree par le staff, a
   * choisi ses champs et ses sujets. Les controles de « Mon profil » ne
   * s'appliquent pas (le repondant n'a souvent pas de compte), et les documents
   * « formulaire seulement » s'ecrivent.
   */
  asForm?: boolean;
  /** Champs poses a la creation d'un document de suivi, par document (le nom du jure, la cible notee...). */
  createWith?: Partial<Record<DocKind, Record<string, unknown>>>;
};

export type FieldWritesPlan = OperationPlan<SetFieldsResult> & { changes: FieldChange[]; rejected: FieldRejection[] };

/**
 * Le plan d'ecriture de `set_fields`, partage avec les formulaires. Chaque
 * etape nomme les champs qu'elle refuse : en mode strict elle leve, en mode
 * partiel ces champs seuls sont ecartes et les etapes suivantes continuent.
 */
export async function planFieldWrites(
  tx: Transaction,
  caller: Caller,
  input: SetFieldsInput,
  options: FieldWritesOptions = {},
): Promise<FieldWritesPlan> {
  const db = getFirestore();
  const s = input.subjects;
  const rejected: FieldRejection[] = [];
  let fields = knownFields(input.values);

  /** Lance une etape ; en mode partiel, son refus ecarte les champs `blamed` au lieu de tout l'appel. */
  const attempt = <T>(blamed: (f: FieldMeta) => boolean, subject: boolean, step: () => T): T | undefined => {
    try {
      return step();
    } catch (error) {
      if (!options.partial || !(error instanceof ApiError)) throw error;
      for (const f of fields.filter(blamed)) rejected.push({ dbField: f.key, message: error.message, subject });
      fields = fields.filter((f) => !blamed(f));
      return undefined;
    }
  };
  const needs = (f: FieldMeta, subject: SubjectKey) => (DOC_KINDS[f.kind].subjects as readonly SubjectKey[]).includes(subject);

  // Etapes sans lecture : un appel invalide ne coute rien.
  if (s.weekStartDayString) attempt((f) => needs(f, "week"), true, () => assertMonday(s.weekStartDayString!));
  const pathByKind = new Map<DocKind, string>();
  for (const kind of new Set(fields.map((f) => f.kind))) {
    const path = attempt((f) => f.kind === kind, true, () => resolvePath(kind, s));
    if (path) pathByKind.set(kind, path);
  }
  const values = new Map<DbFieldKey, FormAnswer>();
  for (const f of fields) {
    attempt((g) => g.key === f.key, false, () => values.set(f.key, parseValue(f, input.values[f.key])));
  }
  if (!options.asForm) {
    assertNotFormOnly(fields);
    assertSelfEditableFields(caller, fields);
  }

  if (fields.length === 0) {
    return { preview: { changes: [], summary: "0 field(s) to write, 0 unchanged." }, commit: null, targetPaths: [], changes: [], rejected };
  }

  // UNE lecture groupee : documents de base, listes fermees, fondateurs cites, documents cibles.
  const subjects = new Set(fields.flatMap((f) => DOC_KINDS[f.kind].subjects as readonly SubjectKey[]));
  const baseDocs = BASE_DOCS.filter((b) => subjects.has(b.subject)).flatMap((b) => {
    const path = b.path(s);
    return path ? [{ ...b, path }] : [];
  });
  const listKeys = [...new Set(fields.flatMap(({ def }) => listKeyOf(def.value) ?? []))];
  const refsOf = (f: FieldMeta) => (f.def.value.kind === "founderRefs" ? (values.get(f.key) as string[]) : []);
  const founderRefIds = [...new Set(fields.flatMap(refsOf))];
  const paths = new Set<string>([
    ...baseDocs.map((b) => b.path),
    ...listKeys.map((k) => docPaths.list(k)),
    ...founderRefIds.map((id) => docPaths.founder(id)),
    ...fields.map((f) => pathByKind.get(f.kind)!),
  ]);
  const snaps = new Map((await tx.getAll(...[...paths].map((p) => db.doc(p)))).map((d) => [d.ref.path, d]));

  for (const b of baseDocs) {
    attempt((f) => needs(f, b.subject), true, () => {
      if (!snaps.get(b.path)!.exists) throw notFound(b.code, `${b.label} \`${b.path.split("/").pop()}\` does not exist.`, `subjects.${SUBJECT_INPUT_KEY[b.subject]}`);
    });
  }
  const dataAt = <T>(path: string | null) => (path ? ((snaps.get(path)?.data() as T | undefined) ?? null) : null);
  const loaded: Loaded = {
    person: dataAt<Person>(s.personId && subjects.has("person") ? docPaths.person(s.personId) : null),
    founder: dataAt<Founder>(s.founderId && subjects.has("founder") ? docPaths.founder(s.founderId) : null),
    startup: dataAt<Startup>(s.startupId && subjects.has("startup") ? docPaths.startup(s.startupId) : null),
    eventBatchId: dataAt<{ batchId: string }>(s.eventId && subjects.has("event") ? docPaths.event(s.eventId) : null)?.batchId ?? null,
  };
  attempt((f) => f.kind === "checkin", true, () => {
    if (fields.some((f) => f.kind === "checkin") && loaded.startup && s.founderId && !loaded.startup.memberIds.includes(s.founderId)) {
      throw badRequest("not_a_member", `Founder \`${s.founderId}\` is not a member of startup \`${s.startupId}\`.`, "subjects.founderId");
    }
  });
  attempt((f) => f.kind === "attendance", true, () => {
    if (fields.some((f) => f.kind === "attendance") && loaded.founder && loaded.eventBatchId && loaded.founder.batchId !== loaded.eventBatchId) {
      throw badRequest("wrong_batch", "This founder and this event belong to different batches.", "subjects.eventId");
    }
  });

  if (!options.asForm) assertOwnsSubjects(caller, fields, s, loaded);

  const lists = new Map(listKeys.flatMap((k) => {
    const list = dataAt<ClosedList>(docPaths.list(k));
    return list ? [[k, list] as const] : [];
  }));
  for (const f of fields) {
    attempt((g) => g.key === f.key, false, () => {
      const missing = refsOf(f).filter((id) => !snaps.get(docPaths.founder(id))!.exists);
      if (missing.length) throw notFound("founder_not_found", `Unknown founders: ${missing.join(", ")}.`, `values.${f.key}`);
      values.set(f.key, normalizeEnum(f, values.get(f.key)!, lists));
    });
  }
  const targets = new Map(fields.map((f) => [f.kind, snaps.get(pathByKind.get(f.kind)!)!]));
  const { changes, patches } = diff(fields, values, targets, options.hold);
  const written = [...patches.values()].reduce((n, patch) => n + Object.keys(patch).length, 0);
  const preview = { changes, summary: `${written} field(s) to write, ${changes.length - written} unchanged.` };
  if (written === 0) return { preview, commit: null, targetPaths: [], changes, rejected };

  // Second aller-retour, seulement si une copie de `people` est en jeu.
  const personPatch = patches.get("person");
  const copies =
    personPatch && loaded.person && Object.keys(personPatch).some((f) => PERSON_FIELDS_WITH_COPIES.has(f))
      ? personCopies(loaded.person, personPatch)
      : null;
  const personFounders =
    copies && loaded.person!.founderIds.length ? await tx.getAll(...loaded.person!.founderIds.map((id) => db.doc(docPaths.founder(id)))) : [];

  const targetPaths = [...patches.keys()].map((k) => pathByKind.get(k)!);
  return {
    preview,
    changes,
    rejected,
    targetPaths,
    commit: (wtx) => {
      const now = new Date().toISOString();
      for (const [kind, patch] of patches) {
        const ref = db.doc(pathByKind.get(kind)!);
        const data: Record<string, unknown> = { ...patch };
        if (DOC_KINDS[kind].timestamped) data.updatedDateISOString = now;
        Object.assign(data, stampOf(kind, { now, uid: caller.uid, asForm: options.asForm === true }));
        if (kind === "person" && copies?.displayName) data.displayName = copies.displayName;

        // Documents de base : leur existence est verifiee plus haut. Sous-documents
        // prives : fusionnes. Documents de suivi : crees complets a la premiere ecriture.
        const lifecycle = DOC_KINDS[kind].lifecycle;
        if (lifecycle === "tracking" && !targets.get(kind)!.exists) {
          const base = TRACKING_BASE[kind as TrackingDocKind](s, loaded);
          const nested = nest(data);
          // Une famille (`metrics`, `scores`) part de l'objet de la base.
          for (const family of FAMILY_HEADS.get(kind) ?? []) {
            if (family in nested) nested[family] = { ...(base[family] as object), ...(nested[family] as object) };
          }
          wtx.set(ref, { ...DEFAULTS_BY_KIND.get(kind), ...base, ...options.createWith?.[kind], ...nested });
        } else {
          wtx.set(ref, nest(data), { merge: true });
        }
      }

      if (copies) {
        for (const f of personFounders) {
          if (!f.exists) continue;
          if (Object.keys(copies.copies.founderDirectory).length) {
            wtx.set(db.doc(docPaths.founderDirectory(f.id)), copies.copies.founderDirectory, { merge: true });
          }
          if (Object.keys(copies.copies.founder).length) wtx.set(f.ref, { ...copies.copies.founder, updatedDateISOString: now }, { merge: true });
        }
      }

      return { written, unchanged: changes.length - written, paths: targetPaths };
    },
  };
}

export const setFields: Operation<typeof SetFieldsInput, SetFieldsResult> = {
  name: "set_fields",
  input: SetFieldsInput,
  // Le staff, et les fondateurs (leur propre profil, verifie champ par champ).
  allowed: (caller) => isStaffViewer(caller.viewer) || caller.foundersByBatch.size > 0,
  plan: (tx, caller, input) => planFieldWrites(tx, caller, input),
};

/**
 * Le registre, tel qu'un agent ou une integration doit le lire (`list fields`),
 * sans les documents « formulaire seulement ». Une famille se lit `<famille>.<key>`.
 */
export function describeFields() {
  const describe = (dbField: string, kind: DocKind, def: FieldDef) => ({
    dbField,
    label: def.label,
    needs: (DOC_KINDS[kind].subjects as readonly SubjectKey[]).map((m) => SUBJECT_INPUT_KEY[m]),
    value: def.value,
    writePolicy: def.writePolicy,
  });
  const fixed = FIELD_KEYS.map(metaOf).filter((m) => !isFormOnly(m.kind)).map((m) => describe(m.key, m.kind, m.def));
  const families = (Object.keys(FIELD_FAMILIES) as (keyof typeof FIELD_FAMILIES)[])
    .map((family) => ({ family, kind: parseDbField(`${family}.x`).doc }))
    .filter(({ kind }) => !isFormOnly(kind))
    .map(({ family, kind }) => describe(`${family}.<key>`, kind, FIELD_FAMILIES[family]));
  return [...fixed, ...families];
}
