import { docPaths } from "./collections";
import {
  CHECKIN_GOALS,
  CHECKIN_METRICS,
  CHECKIN_OPTIONAL,
  goalTarget,
  STANDARD_METRICS,
  withUnit,
  type CheckinGoalKey,
  type CheckinMetricKey,
} from "./presets/standardMetrics";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUSES,
  COMMITMENT_STATUS_LABELS,
  COMMITMENT_STATUSES,
  EXISTING_CO_FOUNDERS,
  EXISTING_CO_FOUNDERS_LABELS,
  PROFILE_CATEGORIES,
  PROFILE_CATEGORY_LABELS,
  submissionStamp,
  PROBLEM_SOURCES,
  PROBLEM_SOURCE_LABELS,
} from "./types";
import type {
  Attendance,
  Checkin,
  ClosedList,
  Evaluation,
  EventKind,
  FormFieldType,
  QuestionScope,
  Founder,
  FounderDirectory,
  FounderInternal,
  FounderProfile,
  FounderWeek,
  MetricKey,
  PeerRating,
  Person,
  Picks,
  SessionRating,
  Startup,
  StartupInternal,
  StartupProfile,
  StartupScoped,
  Submission,
  TargetKind,
  Timestamps,
  Archivable,
} from "./types";

// ----------------------------
// Registre des champs de la base (SPECS §4.4)
// ----------------------------
// LE carnet d'adresses de chaque champ qu'une question de formulaire, une
// colonne d'import CSV ou une suggestion du MCP peut ecrire. Brouillon du
// 11/11 : une question porte `{ question, input type, dbfield }`.
//
// - Une adresse `dbField` vaut `"<docKind>.<champ>"` (ex. `"checkin.totalAmountPaid"`,
//   `"person.linkedinUrl"`). Elle est VERIFIEE A LA COMPILATION : une cle dont
//   le champ n'existe pas dans le type du document est refusee.
// - `value` dit quelle valeur est acceptee : l'API en tire sa validation, et
//   l'editeur de formulaire verifie que le type de la question est compatible
//   (`INPUT_COMPATIBILITY`).
// - Le docKind dit de QUOI il faut connaitre l'id pour ecrire (fondateur,
//   startup, semaine, evenement, equipe) : c'est ainsi qu'un formulaire se
//   rattache tout seul a un fondateur, une startup ou un evenement.
// - `expected` dit quand une valeur absente est un TROU : c'est ce que lit
//   `listMissingFields`.
// - `indicator` remplace l'ancien « tag d'indicateur » : le champ EST l'indicateur.
//
// Ajouter un champ ecrivable = ajouter la propriete au type du document, puis
// une ligne ici. Un formulaire ne cree jamais de schema ; une reponse qui ne
// correspond a aucun champ reste « non rattachee » et le MCP l'analyse.
//
// Deux FAMILLES a cle libre (SPECS §2, decision du 12/11) : les metriques d'une
// equipe (`submission.metrics.<cle>`) et les criteres du jury
// (`evaluation.scores.<cle>`). La cle est celle d'une question du Debrief ou du
// formulaire de jury ; elle reste la meme d'un evenement a l'autre (l'editeur
// propose celles des modeles et celles deja utilisees), ce qui permet de
// comparer les hackathons. Le libelle est celui de la question.

// ---- Documents adressables ---------------------------------------------------

/** Les documents qu'un formulaire peut ecrire, et leur type. */
export type DocKindMap = {
  person: Person;
  founder: Founder;
  founderDirectory: FounderDirectory;
  founderProfile: FounderProfile;
  founderInternal: FounderInternal;
  founderWeek: FounderWeek;
  startup: Startup;
  startupProfile: StartupProfile;
  startupInternal: StartupInternal;
  checkin: Checkin;
  attendance: Attendance;
  sessionRating: SessionRating;
  submission: Submission;
  picks: Picks;
  peerRating: PeerRating;
  evaluation: Evaluation;
};
export type DocKind = keyof DocKindMap;

/**
 * Ce qu'il faut connaitre pour adresser un document. `target` : la cible d'une
 * question par cible (coequipier note, equipe notee) ; `judge` : le jure d'un
 * formulaire de jury (`founder-{id}` ou `jury-{empreinte}`).
 */
export type SubjectKey = "person" | "founder" | "startup" | "event" | "week" | "team" | "target" | "judge";

/** Les ids resolus pour une reponse (par le repondant, le staff ou une question). */
export type ResolvedSubjects = Partial<{
  personId: string;
  founderId: string;
  startupId: string;
  eventId: string;
  weekStartDayString: string;
  teamId: string;
  targetId: string;
  judgeId: string;
}>;

/** A qui « appartient » un document, pour `listMissingFields`. */
export type SubjectOwner = TargetKind;

/**
 * Pour chaque document : les sujets qu'il faut connaitre, a qui il appartient,
 * et son chemin (construit par `docPaths`, une seule source).
 * `path` ne recoit que des sujets deja verifies par `resolveDocPath`.
 */
type Subjects = Record<SubjectKey, string>;

/** Ce que sait l'ecriture au moment de poser ses champs techniques. */
export type WriteStamp = { now: string; uid: string; asForm: boolean; /** Echeance du formulaire qui ecrit (`null` : sans echeance). */ formDeadline?: string | null };

/**
 * `formOnly` : document qui ne s'ecrit QUE par son formulaire (avis entre pairs,
 * picks, notes du jury) : prives, jamais lus ni ecrits par l'API ou le MCP
 * (SPECS §4.8). Le formulaire verifie la cible (coequipier, equipe notee).
 * `scope` : la portee qu'impose le document a une question qui l'ecrit (une
 * soumission est celle de l'equipe...) ; `self` sinon.
 * `stamp` : les champs que toute ecriture pose (qui, quand, d'ou).
 *
 * Cycle de vie d'un document, pour qui l'ecrit (API, import, formulaires) :
 *   base      personne, fondateur, startup : doit exister, jamais cree par un champ
 *   private   sous-document `private/*` : fusionne, cree au besoin
 *   tracking  document de suivi (semaine, update, presence, soumission) : cree a la premiere ecriture
 * `timestamped` : le document porte `updatedDateISOString`.
 */
export type DocLifecycle = "base" | "private" | "tracking";

export const DOC_KINDS = {
  person: { lifecycle: "base", timestamped: true, subjects: ["person"], owner: "founder", path: (s: Subjects) => docPaths.person(s.person) },
  // ---- Documents d'un evenement ecrits par leur seul formulaire ----
  picks: { lifecycle: "tracking", timestamped: false, formOnly: true,
    subjects: ["event", "founder"],
    owner: "founder",
    path: (s: Subjects) => docPaths.picks(s.event, s.founder),
    stamp: ({ now }: WriteStamp) => ({ submittedDateISOString: now }),
  },
  peerRating: { lifecycle: "tracking", timestamped: false, formOnly: true, scope: "each_teammate",
    subjects: ["event", "founder", "target", "team"],
    owner: "founder",
    path: (s: Subjects) => docPaths.peerRating(s.event, s.founder, s.target),
    stamp: ({ now }: WriteStamp) => ({ submittedDateISOString: now }),
  },
  evaluation: { lifecycle: "tracking", timestamped: true, formOnly: true, scope: "each_target",
    subjects: ["event", "judge", "target"],
    owner: "startup",
    path: (s: Subjects) => docPaths.evaluation(s.event, s.judge, s.target),
  },
  founder: { lifecycle: "base", timestamped: true, subjects: ["founder"], owner: "founder", path: (s: Subjects) => docPaths.founder(s.founder) },
  founderDirectory: { lifecycle: "private", timestamped: false,
    subjects: ["founder"],
    owner: "founder",
    path: (s: Subjects) => docPaths.founderDirectory(s.founder),
  },
  founderProfile: { lifecycle: "private", timestamped: false, subjects: ["founder"], owner: "founder", path: (s: Subjects) => docPaths.founderProfile(s.founder) },
  founderInternal: { lifecycle: "private", timestamped: false,
    subjects: ["founder"],
    owner: "founder",
    path: (s: Subjects) => docPaths.founderInternal(s.founder),
  },
  founderWeek: { lifecycle: "tracking", timestamped: true,
    subjects: ["founder", "week"],
    owner: "founder",
    path: (s: Subjects) => docPaths.founderWeek(s.founder, s.week),
  },
  startup: { lifecycle: "base", timestamped: true, subjects: ["startup"], owner: "startup", path: (s: Subjects) => docPaths.startup(s.startup) },
  startupProfile: { lifecycle: "private", timestamped: false, subjects: ["startup"], owner: "startup", path: (s: Subjects) => docPaths.startupProfile(s.startup) },
  startupInternal: { lifecycle: "private", timestamped: false,
    subjects: ["startup"],
    owner: "startup",
    path: (s: Subjects) => docPaths.startupInternal(s.startup),
  },
  checkin: { lifecycle: "tracking", timestamped: true,
    subjects: ["startup", "week", "founder"],
    owner: "startup",
    path: (s: Subjects) => docPaths.checkin(s.startup, s.week, s.founder),
  },
  attendance: { lifecycle: "tracking", timestamped: false,
    subjects: ["event", "founder"],
    owner: "founder",
    path: (s: Subjects) => docPaths.attendance(s.event, s.founder),
    stamp: ({ now, uid }: WriteStamp) => ({ markedByUid: uid, markedDateISOString: now }),
  },
  /** La note en un geste d'une seance (SPECS §4.4) : un formulaire « Session feedback » rattache a l'evenement l'ecrit. */
  sessionRating: { lifecycle: "tracking", timestamped: false, subjects: ["event", "founder"], owner: "founder", path: (s: Subjects) => docPaths.sessionRating(s.event, s.founder) },
  submission: { lifecycle: "tracking", timestamped: false, scope: "team",
    subjects: ["event", "team"],
    owner: "startup",
    path: (s: Subjects) => docPaths.submission(s.event, s.team),
    // La source des releves de metriques (declencheur `onSubmissionWritten`).
    stamp: ({ now, uid, asForm, formDeadline }: WriteStamp) => submissionStamp(uid, asForm ? "self_reported" : "staff", now, asForm ? (formDeadline ?? null) : undefined),
  },
} as const satisfies Record<
  DocKind,
  {
    lifecycle: DocLifecycle;
    timestamped: boolean;
    formOnly?: true;
    scope?: QuestionScope;
    subjects: readonly SubjectKey[];
    owner: SubjectOwner;
    path: (s: Subjects) => string;
    stamp?: (w: WriteStamp) => Record<string, unknown>;
  }
>;

/** Le document ne s'ecrit que par son formulaire (voir `formOnly`). */
export const isFormOnly = (kind: DocKind): boolean => "formOnly" in DOC_KINDS[kind];

/** Une entree de `DOC_KINDS`, avec ses options facultatives. */
type DocKindDef = { scope?: QuestionScope; stamp?: (w: WriteStamp) => Record<string, unknown> };

/** La portee qu'impose le document d'un champ (voir `scope`). */
export const scopeOfDoc = (kind: DocKind): QuestionScope => (DOC_KINDS[kind] as DocKindDef).scope ?? "self";

/** Les champs techniques que pose une ecriture de ce document (voir `stamp`). */
export const stampOf = (kind: DocKind, w: WriteStamp): Record<string, unknown> => (DOC_KINDS[kind] as DocKindDef).stamp?.(w) ?? {};

/** Les documents de suivi, ceux qu'une ecriture cree a la demande. */
export type TrackingDocKind = { [K in DocKind]: (typeof DOC_KINDS)[K]["lifecycle"] extends "tracking" ? K : never }[DocKind];

/** Le nom de chaque sujet dans `ResolvedSubjects` (et dans les entrees de l'API). */
export const SUBJECT_INPUT_KEY = {
  person: "personId",
  founder: "founderId",
  startup: "startupId",
  event: "eventId",
  week: "weekStartDayString",
  team: "teamId",
  target: "targetId",
  judge: "judgeId",
} as const satisfies Record<SubjectKey, keyof ResolvedSubjects>;

/** Chemin Firestore d'un document, ou les sujets qui manquent pour le trouver. */
export function resolveDocPath(
  kind: DocKind,
  s: ResolvedSubjects,
): { ok: true; path: string } | { ok: false; missing: SubjectKey[] } {
  const has: Partial<Record<SubjectKey, string>> = {};
  for (const key of Object.keys(SUBJECT_INPUT_KEY) as SubjectKey[]) has[key] = s[SUBJECT_INPUT_KEY[key]];
  const missing = (DOC_KINDS[kind].subjects as readonly SubjectKey[]).filter((k) => !has[k]);
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, path: DOC_KINDS[kind].path(has as Subjects) };
}

// ---- Adresses des champs -----------------------------------------------------

/**
 * Champs techniques ou calcules, jamais ecrits par un formulaire : ceux des
 * briques communes (horodatage, archivage, rattachement), plus les liens et
 * copies propres a certains documents.
 */
type SystemField =
  | keyof (Timestamps & Archivable & StartupScoped)
  | "uid"
  | "personId"
  | "founderIds"
  | "founderId"
  | "teamId"
  | "stats"
  | "weekStartDayString"
  | "claimedDateISOString"
  | "markedByUid"
  | "markedDateISOString"
  | "submittedDateISOString";

/**
 * Champs du fondateur RECOPIES depuis `people` (copie -> original) : on ecrit
 * l'original, et qui l'ecrit tient la copie a jour dans le meme lot. Les
 * lecteurs du Profile Book ne lisent pas `people`. `name` suit `displayName`,
 * lui-meme derive du prenom et du nom tant qu'il est celui par defaut.
 */
export const PERSON_COPIES = {
  "founder.name": "displayName",
  "founder.photoUrl": "photoUrl",
  "founderDirectory.email": "email",
  "founderDirectory.whatsapp": "whatsapp",
  "founderDirectory.linkedinUrl": "linkedinUrl",
  "founderDirectory.phone": "phone",
  "founderDirectory.slackUserId": "slackUserId",
} as const satisfies Record<string, keyof Person>;

type CopiedField<K extends DocKind> = {
  [P in keyof typeof PERSON_COPIES]: P extends `${K}.${infer F}` ? F : never;
}[keyof typeof PERSON_COPIES];

type WritableField<K extends DocKind> = Exclude<Extract<keyof DocKindMap[K], string>, SystemField | CopiedField<K>>;

/** Toute adresse de champ ecrivable, verifiee contre les types des documents. */
export type DbFieldPath = { [K in DocKind]: `${K}.${WritableField<K>}` }[DocKind];

// ---- Valeurs -------------------------------------------------------------------

export type ValueSpec =
  | { kind: "text"; maxLength: number | null; multiline: boolean }
  | { kind: "textList"; maxItems: number | null }
  | { kind: "number"; min: number | null; max: number | null; integer: boolean }
  | { kind: "rating"; min: number; max: number }
  | { kind: "boolean" }
  | { kind: "day" }
  | { kind: "url" }
  | { kind: "email" }
  | { kind: "phone" }
  /**
   * Valeur d'une liste fermee (`lists/{listKey}`) ou de valeurs fixes ; le
   * libelle d'une valeur fixe (`labels`) est celui qu'affichent l'app et les formulaires.
   */
  | { kind: "enum"; listKey: string | null; values: readonly string[] | null; labels?: Readonly<Record<string, string>> }
  | { kind: "enumMulti"; listKey: string | null; values: readonly string[] | null; labels?: Readonly<Record<string, string>> }
  | { kind: "founderRefs"; maxItems: number | null }
  /** Une URL, ou une liste d'URL si `multiple`. */
  | { kind: "files"; multiple: boolean };
export type ValueKind = ValueSpec["kind"];

/** Une valeur choisie dans une liste (fermee ou fixe) : le seul cas ou une valeur a un libelle. */
export const isEnumValue = (spec: ValueSpec): spec is Extract<ValueSpec, { kind: "enum" | "enumMulti" }> =>
  spec.kind === "enum" || spec.kind === "enumMulti";

/** La liste fermee (`lists/{listKey}`) d'ou viennent les valeurs du champ, s'il en a une. */
export const listKeyOf = (spec: ValueSpec): string | null => (isEnumValue(spec) ? spec.listKey : null);

/**
 * Les valeurs acceptees et leur libelle : la liste fermee (sans ses valeurs
 * archivees), ou les valeurs fixes. `null` si le champ n'est pas une liste.
 */
export function enumOptions(spec: ValueSpec, lists: ReadonlyMap<string, ClosedList>): { value: string; label: string }[] | null {
  if (!isEnumValue(spec)) return null;
  if (spec.listKey) {
    return (lists.get(spec.listKey)?.items ?? []).filter((i) => !i.archived).map((i) => ({ value: i.value, label: i.label }));
  }
  return (spec.values ?? []).map((v) => ({ value: v, label: spec.labels?.[v] ?? v }));
}

/** La valeur est une liste (et vaut `[]` quand elle est vide, jamais `null`). */
export const isListValue = (spec: ValueSpec): boolean =>
  spec.kind === "textList" ||
  spec.kind === "enumMulti" ||
  spec.kind === "founderRefs" ||
  (spec.kind === "files" && spec.multiple);

/** Quels types de question peuvent alimenter quels types de valeur (verifie a l'enregistrement du formulaire). */
export const INPUT_COMPATIBILITY: Record<FormFieldType, readonly ValueKind[]> = {
  text: ["text", "url", "email", "phone", "day"],
  long_text: ["text", "textList", "files"],
  number: ["number"],
  rating: ["rating", "number"],
  single_choice: ["enum", "boolean"],
  multiple_choice: ["enumMulti", "textList"],
  entity_picker: ["founderRefs"],
  link: ["url", "files"],
  file: ["files"],
};

/**
 * Regle d'ecriture quand le champ a deja une valeur.
 *   fill_empty    n'ecrit que si le champ est vide (pre-remplissage, import, LinkedIn)
 *   overwrite     remplace la valeur
 *   merge_unique  ajoute aux valeurs d'une liste, sans doublon
 */
export type WritePolicy = "fill_empty" | "overwrite" | "merge_unique";

/**
 * Quand une valeur absente est un trou.
 *   once       une fois pour toutes (LinkedIn, ICP)
 *   weekly     chaque semaine du batch (update du jeudi)
 *   per_event  pour chaque evenement des mecaniques donnees auquel le fondateur etait attendu
 */
export type Expectation =
  | { scope: "once"; priority: "required" | "useful" }
  | { scope: "weekly"; priority: "required" | "useful" }
  /** Pour chaque evenement auquel le fondateur etait attendu (ceux que l'appelant fournit, `SubjectSnapshot.events`). */
  | { scope: "per_event"; priority: "required" | "useful" };

export type FieldDef = {
  label: string;
  value: ValueSpec;
  writePolicy: WritePolicy;
  expected: Expectation | null;
  /** Indicateur trace en courbe (`kpiSeries`) et utilise par les scores. */
  indicator: MetricKey | null;
  /** Claude peut proposer une valeur a partir de texte libre (toujours avec validation). */
  mcpFillable: boolean;
  /** Toujours valide par le staff avant ecriture, quel que soit le reglage du formulaire (champs sensibles). */
  alwaysApprove: boolean;
};

// Raccourcis de lecture du registre.
const text = (maxLength: number | null = 300, multiline = false): ValueSpec => ({ kind: "text", maxLength, multiline });
const longText = (): ValueSpec => text(4000, true);
const num = (min: number | null = 0, max: number | null = null, integer = true): ValueSpec => ({
  kind: "number",
  min,
  max,
  integer,
});
const yesNo: ValueSpec = { kind: "boolean" };
const once = (priority: "required" | "useful" = "useful"): Expectation => ({ scope: "once", priority });
const weekly: Expectation = { scope: "weekly", priority: "required" };

const field = (label: string, value: ValueSpec, options: Partial<Omit<FieldDef, "label" | "value">> = {}): FieldDef => ({
  label,
  value,
  writePolicy: options.writePolicy ?? "overwrite",
  expected: options.expected ?? null,
  indicator: options.indicator ?? null,
  mcpFillable: options.mcpFillable ?? false,
  alwaysApprove: options.alwaysApprove ?? false,
});

/**
 * Un chiffre de l'update tire du dictionnaire : son libelle dit la periode d'un
 * flux (« this week ») et l'unite, pour qui l'ecrit sans formulaire (API, MCP).
 * Le champ EST son indicateur (meme cle).
 */
const pipeline = (key: CheckinMetricKey): FieldDef => {
  const m = STANDARD_METRICS[key];
  return field(withUnit(`${m.label}${m.nature === "flow" ? " this week" : ""}`, m.unit), m.unit ? num(0, null, false) : num(), {
    expected: CHECKIN_OPTIONAL.has(key) ? null : weekly,
    indicator: key,
  });
};

/** Un objectif chiffre de la semaine suivante, libelle et unite tires du flux vise. */
const goal = (key: CheckinGoalKey): FieldDef => {
  const m = STANDARD_METRICS[goalTarget(key)];
  return field(withUnit(`Goal: ${m.label.toLowerCase()} next week`, m.unit), m.unit ? num(0, null, false) : num(), { indicator: key });
};

/** Les chiffres et objectifs de l'update (`CHECKIN_METRICS`, `CHECKIN_GOALS`), dans l'ordre du formulaire. */
const CHECKIN_NUMBER_FIELDS = Object.fromEntries([
  ...CHECKIN_METRICS.map((key) => [`checkin.${key}`, pipeline(key)]),
  ...CHECKIN_GOALS.map((key) => [`checkin.${key}`, goal(key)]),
]) as Record<`checkin.${CheckinMetricKey | CheckinGoalKey}`, FieldDef>;

/**
 * Le registre. Ses cles sont verifiees par `satisfies` : une adresse fautive
 * ne compile pas. Les noms viennent de SPECS annexe A.
 */
export const DB_FIELDS = {
  // ---- Personne (identite) ----
  "person.firstName": field("First name", text(80), { expected: once("required") }),
  "person.lastName": field("Last name", text(80), { expected: once("required") }),
  "person.phone": field("Phone", { kind: "phone" }, { expected: once() }),
  "person.whatsapp": field("WhatsApp", { kind: "phone" }, { expected: once() }),
  "person.linkedinUrl": field("LinkedIn", { kind: "url" }, { expected: once("required"), mcpFillable: true }),
  "person.photoUrl": field("Photo", { kind: "files", multiple: false }, { expected: once() }),

  // ---- Fondateur : carte et Profile Book ----
  // « required » = un profil complet (decision du 12/11) : les champs du Profile
  // Book (carte de la grille) et ceux qui servent a trouver un cofondateur. La
  // page To do, l'alerte « Profile incomplete » et le tri de la grille lisent
  // cette meme regle (src/lib/completeness.ts).
  /** Grande photo (Storage) : deposee depuis « Mon profil » ou par l'import FA26. */
  "founder.coverPhotoUrl": field("HD photo", { kind: "files", multiple: false }, { expected: once("required") }),
  /** @source SP26 « Profile Category » : propose a l'import, valide par le staff. */
  "founder.profileCategory": field("Profile category", { kind: "enum", listKey: null, values: PROFILE_CATEGORIES, labels: PROFILE_CATEGORY_LABELS }),
  "founder.hardSkills": field("Hard skills", { kind: "enumMulti", listKey: "hardSkills", values: null }, {
    expected: once("required"),
    writePolicy: "merge_unique",
    mcpFillable: true,
  }),
  "founder.industries": field("Industries", { kind: "enumMulti", listKey: "industries", values: null }, {
    expected: once("required"),
    writePolicy: "merge_unique",
    mcpFillable: true,
  }),
  "founder.rolesICouldTake": field("Roles I could take", { kind: "enumMulti", listKey: "positionFit", values: null }, {
    expected: once("required"),
    writePolicy: "merge_unique",
  }),
  "founderDirectory.introduceYourself": field("Introduce yourself", longText(), { expected: once("required") }),
  "founderDirectory.gender": field("Gender", text(40)),
  "founderDirectory.nationality": field("Nationality", text(80), { expected: once("required") }),
  "founderDirectory.country": field("Country", text(80)),
  "founderDirectory.education": field("Main education", text(200), { expected: once("required"), mcpFillable: true }),
  "founderDirectory.degree": field("Degree", { kind: "enum", listKey: "degrees", values: null }, { mcpFillable: true }),
  "founderDirectory.fieldOfStudy": field("Field of study", text(120), { mcpFillable: true }),
  "founderDirectory.yearsOfXP": field("Years of experience", num(0, 60), { expected: once(), mcpFillable: true }),
  "founderDirectory.notableCompanies": field("Notable companies", { kind: "textList", maxItems: 20 }, {
    expected: once("required"),
    writePolicy: "merge_unique",
    mcpFillable: true,
  }),
  "founderDirectory.trackRecord": field("Track record", longText(), { expected: once("required") }),
  "founderDirectory.interestedInWorkingOn": field("Interested in working on", longText(), { expected: once("required") }),
  "founderDirectory.hasExistingProject": field("Existing project", yesNo, { expected: once() }),
  "founderDirectory.projectExplanation": field("Project explanation", longText()),
  "founderDirectory.hasExistingCoFounders": field(
    "Existing co-founders",
    { kind: "enum", listKey: null, values: EXISTING_CO_FOUNDERS, labels: EXISTING_CO_FOUNDERS_LABELS },
    { expected: once() },
  ),
  "founderDirectory.openToJoinAnotherProject": field("Open to join another project", yesNo, { expected: once() }),
  "founderDirectory.mainStartup2025": field("Main startup in 2025", text(120)),
  "founderDirectory.lookingForCoFounder": field("Looking for a co-founder", yesNo, { expected: once() }),
  "founderDirectory.coFounderTypeWanted": field("Type of co-founder wanted", text(120)),
  "founderDirectory.coFounderSkillsWanted": field("Skills wanted in a co-founder", { kind: "enumMulti", listKey: "hardSkills", values: null }, {
    writePolicy: "merge_unique",
  }),
  "founderDirectory.industriesToExplore": field("Industries to gain experience in", { kind: "enumMulti", listKey: "industries", values: null }, {
    writePolicy: "merge_unique",
  }),
  /** @source SP26 « Age » : garde tel quel a l'import. */
  "founderProfile.age": field("Age", num(0, 120)),
  "founderProfile.birthDayString": field("Birth date", { kind: "day" }),
  "founderProfile.housingSupport": field("Housing support", yesNo),
  "founderProfile.tShirtSize": field("T-shirt size", { kind: "enum", listKey: null, values: ["XS", "S", "M", "L", "XL", "XXL"] }),
  "founderProfile.enrolmentConfirmed": field("Enrolment confirmed", yesNo, { expected: once("required") }),

  // ---- Fondateur : suivi hebdomadaire (formulaires de motivation et d'objectifs) ----
  "founderWeek.learnings": field("3 learnings", longText(), { expected: weekly, mcpFillable: true }),
  "founderWeek.interestedInFounderIds": field("Interested in founders", { kind: "founderRefs", maxItems: 10 }, {
    expected: weekly,
  }),
  "founderWeek.goalForWeek": field("Goal for the week", longText(), { expected: weekly }),
  "founderWeek.commitmentStatus": field(
    "Commitment status",
    { kind: "enum", listKey: null, values: COMMITMENT_STATUSES, labels: COMMITMENT_STATUS_LABELS },
    { expected: weekly },
  ),
  "founderWeek.projectName": field("Project name", text(120)),
  "founderWeek.workingWithFounderIds": field("Working with", { kind: "founderRefs", maxItems: 10 }, { expected: weekly }),
  "founderWeek.priorityForWeek": field("Priority for the week", longText()),
  "founderWeek.feelingForWeek": field("How do you feel", longText()),
  "founderWeek.anythingSpecific": field("Anything specific to mention", longText()),

  // ---- Fondateur : presence ----
  "attendance.status": field(
    "Attendance",
    { kind: "enum", listKey: null, values: ATTENDANCE_STATUSES, labels: ATTENDANCE_STATUS_LABELS },
    { expected: { scope: "per_event", priority: "required" } },
  ),

  // ---- Fondateur : note de seance ----
  "sessionRating.rating": field("Session rating", { kind: "rating", min: 1, max: 5 }),
  "sessionRating.comment": field("Session comment", longText()),

  // ---- Startup : carte et profil ----
  "startup.name": field("Startup name", text(80), { expected: once("required") }),
  "startup.logoUrl": field("Logo", { kind: "files", multiple: false }, { expected: once() }),
  "startup.websiteUrl": field("Website", { kind: "url" }, { expected: once() }),
  "startup.ideaOneLine": field("One-liner", text(200), { expected: once("required"), mcpFillable: true }),
  "startup.vertical": field("Vertical", { kind: "enum", listKey: "industries", values: null }, {
    expected: once(),
    mcpFillable: true,
  }),
  "startupProfile.icp": field("ICP", longText(), { expected: once("required"), mcpFillable: true }),
  "startupProfile.problem": field("Problem", longText(), { expected: once("required"), mcpFillable: true }),
  "startupProfile.solution": field("Solution", longText(), { expected: once("required"), mcpFillable: true }),
  "startupProfile.whyNow": field("Why now", longText(), { expected: once(), mcpFillable: true }),
  "startupProfile.currentStatus": field("Current status", longText()),
  "startupProfile.anythingElse": field("Anything else", longText()),
  "startupProfile.pitchDeckUrl": field("Pitch deck", { kind: "url" }, { expected: once() }),
  "startupProfile.driveFolderUrl": field("Drive folder", { kind: "url" }),
  "startupProfile.product": field("Product", longText(), { mcpFillable: true }),
  "startupProfile.technology": field("Technology", longText(), { mcpFillable: true }),
  "startupProfile.usersGoal": field("Users goal", num()),
  "startupProfile.revenueGoal": field("Revenue goal", num(0, null, false)),
  "startupProfile.plannedMilestones": field("Planned milestones", longText()),
  "startupProfile.teamFormedDayString": field("Date the team formed", { kind: "day" }),

  // ---- Startup : evaluation du staff (toujours validee) ----
  "startupInternal.go": field("Go", yesNo, { alwaysApprove: true }),
  "startupInternal.clearIdea": field("Clear idea", yesNo, { alwaysApprove: true }),
  "startupInternal.highPotential": field("High potential", yesNo, { alwaysApprove: true }),
  "startupInternal.slideQuality": field("Slide quality", { kind: "rating", min: 1, max: 5 }, { alwaysApprove: true }),
  "startupInternal.achievements": field("Achievements", longText(), { alwaysApprove: true, mcpFillable: true }),
  "startupInternal.achievementsScore": field("Achievements score", { kind: "rating", min: 0, max: 6 }, {
    alwaysApprove: true,
  }),
  "startupInternal.risks": field("Risks", longText(), { alwaysApprove: true }),
  "startupInternal.notes": field("Notes", longText(), { alwaysApprove: true }),
  "startupInternal.tractionNotes": field("Traction notes", longText(), { alwaysApprove: true }),

  // ---- Startup : update du jeudi (cles standard, presets/standardMetrics.ts) ----
  // Les chiffres de TOUTE la startup : flux de la semaine, puis totaux a date.
  ...CHECKIN_NUMBER_FIELDS,
  "checkin.moral": field("Morale", { kind: "rating", min: 1, max: 10 }, { expected: weekly, indicator: "moral" }),
  // Historique Spring 2026, de definition inconnue : garde pour ses courbes, plus demande.
  "checkin.revenue": field("Revenue this week (Spring 2026, legacy)", num(0, null, false), { indicator: "revenue" }),
  "checkin.totalRevenue": field("Total revenue (Spring 2026, legacy)", num(0, null, false), { indicator: "totalRevenue" }),
  "checkin.goals": field("Goals", longText()),
  "checkin.obstacle": field("Biggest obstacle", longText(), { expected: weekly }),
  "checkin.learned": field("What you learned from users", longText()),
  "checkin.achievement": field("Achievement of the week", longText()),
  "checkin.helpNeeded": field("How can we help", longText()),
  "checkin.attachmentUrls": field("Documents", { kind: "files", multiple: true }, { writePolicy: "merge_unique" }),

  // ---- Soumission d'equipe (Debrief, portee « son equipe ») ----
  "submission.title": field("Title", text(120)),
  "submission.pitchOneLine": field("One-line pitch", text(200)),
  "submission.videoUrl": field("Video", { kind: "url" }),
  "submission.repoUrl": field("GitHub repository", { kind: "url" }),
  "submission.slideUrl": field("Slides", { kind: "url" }),
  "submission.productUrl": field("Product", { kind: "url" }),
  "submission.proofUrls": field("Proof links", { kind: "files", multiple: true }),
  "submission.notes": field("Team notes", text(2000, true)),
  "submission.painSentence": field("Pain in one sentence", text(300)),
  "submission.problemSource": field("Problem source", { kind: "enum", listKey: null, values: PROBLEM_SOURCES, labels: PROBLEM_SOURCE_LABELS }),
  "submission.learnings": field("What the team learned", longText()),
  "submission.driveFolderUrl": field("Drive folder", { kind: "url" }),

  // ---- Avis entre pairs (Debrief, portee « chaque coequipier ») ----
  "peerRating.rating": field("Would start a company with this person", { kind: "rating", min: 1, max: 5 }),
  "peerRating.comment": field("One line on this teammate", text(280)),

  // ---- Choix prives (formulaire Picks ou Founder introductions) ----
  "picks.pickedFounderIds": field("Picks", { kind: "founderRefs", maxItems: 10 }),

  // ---- Notes du jury (portee « chaque equipe ») : les criteres sont la famille `evaluation.scores` ----
  "evaluation.comment": field("Jury comment", text(1000, true)),
} as const satisfies Partial<Record<DbFieldPath, FieldDef>>;

/**
 * Les familles a cle libre (voir l'en-tete) : `<famille>.<cle>`. Une metrique
 * peut etre un pourcentage (taux de conversion) : pas forcement entiere. Une
 * note du jury suit l'echelle de sa question (verifiee par le formulaire).
 */
export const FIELD_FAMILIES = {
  "submission.metrics": field("Team metric", num(0, null, false)),
  "evaluation.scores": field("Jury score", num(0, 100, false)),
} as const satisfies Record<string, FieldDef>;

/** Le seul type de question qui alimente une famille : une metrique est un nombre, un critere une note. */
export const FAMILY_QUESTION_TYPE: Record<keyof typeof FIELD_FAMILIES, FormFieldType> = {
  "submission.metrics": "number",
  "evaluation.scores": "rating",
};
export type FieldFamily = keyof typeof FIELD_FAMILIES;

/** Une cle de famille : une lettre minuscule, puis lettres et chiffres (`callsMade`, `teamQuality`). */
export const FAMILY_KEY = /^[a-z][A-Za-z0-9]{0,39}$/;

/** Adresse d'un champ du registre : le type de `FormQuestion.dbField`. */
export type DbFieldKey = keyof typeof DB_FIELDS | `${FieldFamily}.${string}`;

/** La famille et la cle d'une adresse de famille (`submission.metrics.callsMade`), sinon `null`. */
export function familyOf(raw: string): { family: FieldFamily; key: string } | null {
  for (const family of Object.keys(FIELD_FAMILIES) as FieldFamily[]) {
    if (raw.startsWith(`${family}.`)) {
      const key = raw.slice(family.length + 1);
      return FAMILY_KEY.test(key) ? { family, key } : null;
    }
  }
  return null;
}

/** L'adresse existe : un champ du registre, ou une cle valide d'une famille. */
export const isDbFieldKey = (raw: string): raw is DbFieldKey => raw in DB_FIELDS || familyOf(raw) !== null;

/** La cle d'un champ de cette famille, sinon `null`. */
const familyKeyOf = (family: FieldFamily) => (dbField: DbFieldKey | null): string | null => {
  const f = dbField ? familyOf(dbField) : null;
  return f?.family === family ? f.key : null;
};

/** La cle de metrique d'une question du Debrief (`submission.metrics.<cle>`), sinon `null`. */
export const metricKeyOf = familyKeyOf("submission.metrics");

/** La cle de critere d'une question du jury (`evaluation.scores.<cle>`), sinon `null`. */
export const criterionKeyOf = familyKeyOf("evaluation.scores");

export function parseDbField(key: DbFieldKey): { doc: DocKind; field: string } {
  const dot = key.indexOf(".");
  return { doc: key.slice(0, dot) as DocKind, field: key.slice(dot + 1) };
}

export const getFieldDef = (key: DbFieldKey): FieldDef => {
  if (key in DB_FIELDS) return DB_FIELDS[key as keyof typeof DB_FIELDS];
  const family = familyOf(key);
  if (!family) throw new Error(`Unknown field \`${key}\`.`);
  return FIELD_FAMILIES[family.family];
};

/** Les sujets qu'un ensemble de champs exige : c'est le rattachement automatique d'un formulaire. */
export function requiredSubjects(keys: readonly DbFieldKey[]): SubjectKey[] {
  const out = new Set<SubjectKey>();
  for (const key of keys) for (const s of DOC_KINDS[parseDbField(key).doc].subjects) out.add(s);
  return [...out];
}

// ---- Champs manquants --------------------------------------------------------

/** Un trou : un champ attendu sans valeur, et qui peut le combler. */
export type MissingField = {
  dbField: DbFieldKey;
  priority: "required" | "useful";
  /** Renseigne pour un champ hebdomadaire. */
  weekStartDayString: string | null;
  /** Renseigne pour un champ par evenement. */
  eventId: string | null;
  /** Formulaires ouverts ou planifies qui posent cette question. */
  fillableByFormIds: string[];
  mcpFillable: boolean;
};

type DocsByKind = Partial<Record<DocKind, Record<string, unknown> | null>>;

/** Tout ce que l'on sait d'un fondateur ou d'une startup, lu par la fonction serveur. */
export type SubjectSnapshot = {
  owner: SubjectOwner;
  /** Documents « une fois » (person, founder, founderDirectory, startupProfile...). */
  docs: DocsByKind;
  /** Une entree par semaine ecoulee du batch. */
  weeks: { weekStartDayString: string; docs: DocsByKind }[];
  /** Evenements auxquels le fondateur etait attendu. */
  events: { eventId: string; eventKind: EventKind; docs: DocsByKind }[];
};

/** Une valeur absente : `null`, chaine vide ou liste vide. La regle de `fill_empty` et des champs manquants. */
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Liste les champs attendus et vides d'un fondateur ou d'une startup, et dit
 * quel formulaire ou si le MCP peut les remplir (fonction demandee dans le
 * brouillon du 11/11). Logique pure : la Cloud Function lit les documents,
 * appelle cette fonction et ecrit le resultat dans `completeness`.
 */
/** Les champs attendus, regroupes par proprietaire : calcule une fois au chargement. */
const EXPECTED_BY_OWNER: Record<SubjectOwner, { key: DbFieldKey; doc: DocKind; name: string; def: FieldDef & { expected: Expectation } }[]> = {
  founder: [],
  startup: [],
};
for (const key of Object.keys(DB_FIELDS) as (keyof typeof DB_FIELDS)[]) {
  const def = getFieldDef(key);
  if (!def.expected) continue;
  const { doc, field: name } = parseDbField(key);
  EXPECTED_BY_OWNER[DOC_KINDS[doc].owner].push({ key, doc, name, def: { ...def, expected: def.expected } });
}

/** Le nombre de champs obligatoires « une fois » d'un fondateur ou d'une startup : le denominateur de la completude. */
export const countRequiredFields = (owner: SubjectOwner): number =>
  EXPECTED_BY_OWNER[owner].filter((e) => e.def.expected.scope === "once" && e.def.expected.priority === "required").length;

export function listMissingFields(
  snapshot: SubjectSnapshot,
  formsByField: Partial<Record<DbFieldKey, string[]>> = {},
): MissingField[] {
  const out: MissingField[] = [];
  for (const { key, doc, name, def } of EXPECTED_BY_OWNER[snapshot.owner]) {
    const base = {
      dbField: key,
      priority: def.expected.priority,
      fillableByFormIds: formsByField[key] ?? [],
      mcpFillable: def.mcpFillable,
    };
    const read = (docs: DocsByKind) => docs[doc]?.[name];
    switch (def.expected.scope) {
      case "once":
        if (isEmptyValue(read(snapshot.docs))) out.push({ ...base, weekStartDayString: null, eventId: null });
        break;
      case "weekly":
        for (const week of snapshot.weeks) {
          if (isEmptyValue(read(week.docs))) {
            out.push({ ...base, weekStartDayString: week.weekStartDayString, eventId: null });
          }
        }
        break;
      case "per_event": {
        for (const event of snapshot.events) {
          if (isEmptyValue(read(event.docs))) {
            out.push({ ...base, weekStartDayString: null, eventId: event.eventId });
          }
        }
        break;
      }
    }
  }
  return out;
}
