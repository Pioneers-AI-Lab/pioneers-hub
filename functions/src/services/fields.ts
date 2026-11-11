import { getFirestore, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { COL, docPaths } from "../shared/collections";
import {
  DB_FIELDS,
  DOC_KINDS,
  getFieldDef,
  isEmptyValue,
  isListValue,
  parseDbField,
  PERSON_COPIES,
  resolveDocPath,
  SUBJECT_INPUT_KEY,
  type DbFieldKey,
  type DocKind,
  type FieldDef,
  type ResolvedSubjects,
  type SubjectKey,
  type TrackingDocKind,
  type ValueSpec,
} from "../shared/fieldRegistry";
import type { ClosedList, FormAnswer, Founder, Person, Startup } from "../shared/types";
import { badRequest, notFound } from "../api/errors";
import type { Operation, OperationPlan } from "./operations";
import { dayString } from "./schemas";

// ----------------------------
// services - ecrire des CHAMPS du registre
// ----------------------------
// LE geste d'ecriture generique : une liste d'adresses `dbField`
// (`startupProfile.icp`, `checkin.revenue`, `person.linkedinUrl`) et leurs
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
//
// Toutes les lectures partent en UN aller-retour (`tx.getAll`), plus un second
// pour les fondateurs d'une personne quand une copie est en jeu : l'operation
// est planifiee deux fois par le MCP (apercu, confirmation).

const FIELD_KEYS = Object.keys(DB_FIELDS) as DbFieldKey[];

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
      .describe('Field address -> value, e.g. {"startupProfile.icp": "...", "checkin.revenue": 1200}.'),
  })
  .strict();
export type SetFieldsInput = z.output<typeof SetFieldsInput>;

// ---- Le registre, lu une fois au chargement ---------------------------------------

const httpUrl = z.url({ protocol: /^https?$/ });
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

const META = new Map<DbFieldKey, FieldMeta>(
  FIELD_KEYS.map((key) => {
    const { doc: kind, field } = parseDbField(key);
    const def = getFieldDef(key);
    return [key, { key, kind, field, def, schema: valueSchema(def.value) }];
  }),
);

/** Valeurs par defaut d'un document de suivi cree par une ecriture : `[]` pour une liste, `null` sinon. */
const DEFAULTS_BY_KIND = new Map<DocKind, Record<string, FormAnswer>>();
for (const m of META.values()) {
  DEFAULTS_BY_KIND.set(m.kind, { ...DEFAULTS_BY_KIND.get(m.kind), [m.field]: isListValue(m.def.value) ? [] : null });
}

const PERSON_COPY_ENTRIES = Object.entries(PERSON_COPIES).map(([copy, source]) => {
  const { doc: kind, field } = parseDbField(copy as DbFieldKey);
  return { kind: kind as "founder" | "founderDirectory", field, source: source as keyof Person };
});
/** Champs de `people` dont l'ecriture touche les fondateurs (copies, et le nom affiche derive). */
const PERSON_FIELDS_WITH_COPIES = new Set<string>([...PERSON_COPY_ENTRIES.map((c) => c.source), "firstName", "lastName"]);

// ---- Les etapes du plan ---------------------------------------------------------

type Loaded = { person: Person | null; founder: Founder | null; startup: Startup | null; eventBatchId: string | null };

type FieldChange = { dbField: DbFieldKey; before: unknown; after: unknown; status: "write" | "unchanged"; reason?: string };

/** 0. Chaque adresse existe dans le registre ; sinon, les plus proches. */
function knownFields(values: Record<string, unknown>): FieldMeta[] {
  return Object.keys(values).map((raw) => {
    const meta = META.get(raw as DbFieldKey);
    if (meta) return meta;
    const [doc = "", field = ""] = raw.split(".");
    const near = FIELD_KEYS.filter((k) => k.startsWith(`${doc}.`) || k.toLowerCase().endsWith(`.${field.toLowerCase()}`)).slice(0, 8);
    throw badRequest(
      "unknown_field",
      `\`${raw}\` is not a writable field.${near.length ? ` Closest: ${near.join(", ")}.` : ""} The full list: list \`fields\`.`,
      `values.${raw}`,
    );
  });
}

/** 1. Le chemin de chaque document, ou l'id qui manque pour le trouver. */
function resolvePaths(kinds: DocKind[], s: ResolvedSubjects): Map<DocKind, string> {
  const paths = new Map<DocKind, string>();
  for (const kind of kinds) {
    const resolved = resolveDocPath(kind, s);
    if (!resolved.ok) {
      const names = resolved.missing.map((m) => SUBJECT_INPUT_KEY[m]);
      throw badRequest("missing_subject", `Fields of \`${kind}\` need \`subjects.${names.join("`, `subjects.")}\`.`, `subjects.${names[0]}`);
    }
    paths.set(kind, resolved.path);
  }
  if (s.weekStartDayString && new Date(`${s.weekStartDayString}T00:00:00Z`).getUTCDay() !== 1) {
    throw badRequest("invalid_week", "`weekStartDayString` must be the Monday of the week.", "subjects.weekStartDayString");
  }
  return paths;
}

/** 2. Les valeurs, validees par le registre (sans lecture). */
function parseValues(fields: FieldMeta[], raw: Record<string, unknown>): Map<DbFieldKey, FormAnswer> {
  const values = new Map<DbFieldKey, FormAnswer>();
  for (const { key, schema } of fields) {
    const parsed = schema.safeParse(raw[key]);
    if (!parsed.success) {
      throw badRequest("invalid_value", `\`${key}\`: ${parsed.error.issues[0]?.message ?? "invalid value"}`, `values.${key}`);
    }
    values.set(key, parsed.data as FormAnswer);
  }
  return values;
}

/** Les documents de base que les sujets nomment, et leur refus s'ils n'existent pas. */
const BASE_DOCS: { subject: SubjectKey; path: (s: ResolvedSubjects) => string | null; code: string; label: string }[] = [
  { subject: "person", path: (s) => (s.personId ? docPaths.person(s.personId) : null), code: "person_not_found", label: "Person" },
  { subject: "founder", path: (s) => (s.founderId ? docPaths.founder(s.founderId) : null), code: "founder_not_found", label: "Founder" },
  { subject: "startup", path: (s) => (s.startupId ? docPaths.startup(s.startupId) : null), code: "startup_not_found", label: "Startup" },
  { subject: "event", path: (s) => (s.eventId ? docPaths.event(s.eventId) : null), code: "event_not_found", label: "Event" },
  { subject: "team", path: (s) => (s.eventId && s.teamId ? docPaths.team(s.eventId, s.teamId) : null), code: "team_not_found", label: "Team" },
];

/** 3. Les listes fermees : une valeur se reconnait par sa cle ou son libelle, sans casse. */
function normalizeEnums(fields: FieldMeta[], values: Map<DbFieldKey, FormAnswer>, lists: Map<string, ClosedList>) {
  for (const { key, def } of fields) {
    const spec = def.value;
    if (spec.kind !== "enum" && spec.kind !== "enumMulti") continue;
    const allowed = spec.listKey
      ? (lists.get(spec.listKey)?.items ?? []).filter((i) => !i.archived).map((i) => ({ value: i.value, label: i.label }))
      : (spec.values ?? []).map((v) => ({ value: v, label: v }));
    const normalize = (raw: string) => {
      const lower = raw.toLowerCase();
      const hit = allowed.find((a) => a.value.toLowerCase() === lower || a.label.toLowerCase() === lower);
      if (hit) return hit.value;
      const sample = allowed.slice(0, 15).map((a) => a.value).join(", ");
      throw badRequest("invalid_value", `\`${key}\`: unknown value "${raw}". Accepted: ${sample}${allowed.length > 15 ? ", ..." : ""}.`, `values.${key}`);
    };
    const v = values.get(key);
    values.set(key, Array.isArray(v) ? [...new Set(v.map(normalize))] : normalize(v as string));
  }
}

/** 4. Ce qui change, champ par champ, selon la regle d'ecriture du registre. */
function diff(fields: FieldMeta[], values: Map<DbFieldKey, FormAnswer>, targets: Map<DocKind, DocumentSnapshot>) {
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

    changes.push({ dbField: key, before: current ?? null, after, status: reason ? "unchanged" : "write", ...(reason ? { reason } : {}) });
    if (!reason) patches.set(kind, { ...patches.get(kind), [field]: after });
  }
  return { changes, patches };
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
  submission: (s) => ({ teamId: s.teamId, deliverables: {}, metrics: {}, productUrl: null, links: [], submittedDateISOString: null }),
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
  return { displayName: next.displayName as string | undefined, copies };
}

// ---- L'operation -----------------------------------------------------------------

export type SetFieldsResult = { written: number; unchanged: number; paths: string[] };

export const setFields: Operation<typeof SetFieldsInput, SetFieldsResult> = {
  name: "set_fields",
  input: SetFieldsInput,
  async plan(tx: Transaction, caller, input): Promise<OperationPlan<SetFieldsResult>> {
    const db = getFirestore();
    const s = input.subjects;

    // Etapes sans lecture : un appel invalide ne coute rien.
    const fields = knownFields(input.values);
    const kinds = [...new Set(fields.map((f) => f.kind))];
    const pathByKind = resolvePaths(kinds, s);
    const values = parseValues(fields, input.values);

    // UNE lecture groupee : documents de base, listes fermees, fondateurs cites, documents cibles.
    const needs = new Set(kinds.flatMap((k) => DOC_KINDS[k].subjects as readonly SubjectKey[]));
    const baseDocs = BASE_DOCS.filter((b) => needs.has(b.subject)).flatMap((b) => {
      const path = b.path(s);
      return path ? [{ ...b, path }] : [];
    });
    const listKeys = [
      ...new Set(fields.flatMap(({ def }) => ((def.value.kind === "enum" || def.value.kind === "enumMulti") && def.value.listKey ? [def.value.listKey] : []))),
    ];
    const founderRefIds = [...new Set(fields.flatMap(({ key, def }) => (def.value.kind === "founderRefs" ? (values.get(key) as string[]) : [])))];
    const paths = new Set<string>([
      ...baseDocs.map((b) => b.path),
      ...listKeys.map((k) => `${COL.lists}/${k}`),
      ...founderRefIds.map((id) => docPaths.founder(id)),
      ...pathByKind.values(),
    ]);
    const snaps = new Map((await tx.getAll(...[...paths].map((p) => db.doc(p)))).map((d) => [d.ref.path, d]));

    for (const b of baseDocs) {
      if (!snaps.get(b.path)!.exists) throw notFound(b.code, `${b.label} \`${b.path.split("/").pop()}\` does not exist.`, `subjects.${SUBJECT_INPUT_KEY[b.subject]}`);
    }
    const dataAt = <T>(path: string | null) => (path ? ((snaps.get(path)?.data() as T | undefined) ?? null) : null);
    const loaded: Loaded = {
      person: dataAt<Person>(s.personId && needs.has("person") ? docPaths.person(s.personId) : null),
      founder: dataAt<Founder>(s.founderId && needs.has("founder") ? docPaths.founder(s.founderId) : null),
      startup: dataAt<Startup>(s.startupId && needs.has("startup") ? docPaths.startup(s.startupId) : null),
      eventBatchId: dataAt<{ batchId: string }>(s.eventId && needs.has("event") ? docPaths.event(s.eventId) : null)?.batchId ?? null,
    };
    if (kinds.includes("checkin") && loaded.startup && s.founderId && !loaded.startup.memberIds.includes(s.founderId)) {
      throw badRequest("not_a_member", `Founder \`${s.founderId}\` is not a member of startup \`${s.startupId}\`.`, "subjects.founderId");
    }
    if (kinds.includes("attendance") && loaded.founder && loaded.eventBatchId && loaded.founder.batchId !== loaded.eventBatchId) {
      throw badRequest("wrong_batch", "This founder and this event belong to different batches.", "subjects.eventId");
    }

    const missingFounders = founderRefIds.filter((id) => !snaps.get(docPaths.founder(id))!.exists);
    if (missingFounders.length) throw notFound("founder_not_found", `Unknown founders: ${missingFounders.join(", ")}.`, "values");
    normalizeEnums(fields, values, new Map(listKeys.flatMap((k) => {
      const list = dataAt<ClosedList>(`${COL.lists}/${k}`);
      return list ? [[k, list] as const] : [];
    })));

    const targets = new Map(kinds.map((k) => [k, snaps.get(pathByKind.get(k)!)!]));
    const { changes, patches } = diff(fields, values, targets);
    const written = changes.filter((c) => c.status === "write").length;
    const preview = { changes, summary: `${written} field(s) to write, ${changes.length - written} unchanged.` };
    if (written === 0) return { preview, commit: null, targetPaths: [] };

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
      targetPaths,
      commit: (wtx) => {
        const now = new Date().toISOString();
        for (const [kind, patch] of patches) {
          const ref = db.doc(pathByKind.get(kind)!);
          const data: Record<string, unknown> = { ...patch };
          if (DOC_KINDS[kind].timestamped) data.updatedDateISOString = now;
          if (kind === "attendance") Object.assign(data, { markedByUid: caller.uid, markedDateISOString: now });
          if (kind === "person" && copies?.displayName) data.displayName = copies.displayName;

          // Documents de base : leur existence est verifiee plus haut. Sous-documents
          // prives : fusionnes. Documents de suivi : crees complets a la premiere ecriture.
          const lifecycle = DOC_KINDS[kind].lifecycle;
          if (lifecycle === "tracking" && !targets.get(kind)!.exists) {
            const base = TRACKING_BASE[kind as TrackingDocKind](s, loaded);
            wtx.set(ref, { ...DEFAULTS_BY_KIND.get(kind), ...base, ...data });
          } else {
            wtx.set(ref, data, { merge: true });
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
  },
};

/** Le registre, tel qu'un agent ou une integration doit le lire (`list fields`). */
export function describeFields() {
  return [...META.values()].map(({ key, kind, def }) => ({
    dbField: key,
    label: def.label,
    needs: (DOC_KINDS[kind].subjects as readonly SubjectKey[]).map((m) => SUBJECT_INPUT_KEY[m]),
    value: def.value,
    writePolicy: def.writePolicy,
  }));
}
