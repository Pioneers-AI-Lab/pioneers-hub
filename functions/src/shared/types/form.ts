import type { DbFieldKey, MissingField, ResolvedSubjects, SubjectKey } from "../fieldRegistry";
import type { Archivable, BatchScoped, DateISOString, TargetKind, Timestamps } from "./common";

// ----------------------------
// Formulaires (SPECS §4.4, brouillon du 11/11)
// ----------------------------
//   forms/{formId}                       Form             public (lien partage)
//   forms/{formId}/versions/{version}    FormVersion      public
//   formResponses/{responseId}           FormResponse     staff + investors IC (sauf feedback entre pairs)
//   fieldSuggestions/{suggestionId}      FieldSuggestion  staff
//   completeness/{owner}_{id}            Completeness     staff + investors IC
//
// Un formulaire est un MOYEN DE SAISIE : chaque question peut ecrire
// directement dans un champ de la base (`dbField`, voir fieldRegistry.ts).
// La donnee vit ensuite dans les documents types (`checkins`, `founderWeeks`,
// profils...) ; la reponse garde la trace brute et le journal des ecritures.
//
//   1. Rattachement : le formulaire sait de quoi ses champs ont besoin
//      (fondateur, startup, semaine, evenement, equipe) et d'ou vient chaque
//      id (`attachments`) : le repondant, sa startup, un id choisi par le
//      staff, une question « choisir un fondateur »...
//   2. Ecriture : chaque valeur est validee selon son champ, puis ecrite
//      (`applied`) ou mise en attente (`pending_approval`) selon `approval`.
//   3. Reponses non rattachees : questions sans `dbField`, valeurs invalides,
//      sujets introuvables. Elles restent sur la reponse ; Claude les analyse
//      par le MCP et propose des `fieldSuggestions`. Rien n'est ecrit sans
//      accord du staff.
//   4. Champs manquants : `listMissingFields` (fieldRegistry.ts) en tire la
//      liste, stockee dans `completeness`.
//
// Modifier un formulaire sans casser l'historique :
// - chaque reponse garde la version du formulaire a laquelle elle repond ;
// - une question supprimee est archivee, pas effacee ;
// - changer le type d'une question cree une nouvelle question (nouvel `id`).

export type FormKind =
  | "onboarding"
  | "motivation"
  | "goal"
  | "weekly_update"
  | "exercise_feedback"
  | "session_feedback"
  | "peer_feedback"
  | "exit"
  | "custom";

/** Les 7 types de la spec (le lien et le fichier sont separes, le texte long aussi). */
export type FormFieldType =
  | "text"
  | "long_text"
  | "number"
  | "rating"
  | "single_choice"
  | "multiple_choice"
  /** Choisir un objet dans une liste : fondateur, startup, evenement, equipe, mentor (jamais un nom tape). */
  | "entity_picker"
  | "link"
  | "file";

/** Ce que propose une question `entity_picker`. */
export type PickerEntity = "founder" | "startup" | "event" | "team" | "mentor";

/**
 * Indicateurs NUMERIQUES traces en courbe (`kpiSeries`, `portfolioReports`).
 * Un champ du registre en est un quand son `indicator` est renseigne ; les
 * textes de l'update (objectifs, obstacle...) n'en sont pas.
 */
export const METRIC_KEYS = [
  // Startup · update du jeudi (SP26 « Weekly wrap-up », 2025 « Weekly forms »)
  "interviews",
  "activeUsers",
  "totalUsers",
  "revenue",
  "totalRevenue",
  "moral",
  "outbound",
  "featuresShipped",
  // Startup · objectifs de la semaine suivante (SP26 « goals for next week »)
  "goalOutreach",
  "goalInterviews",
  "goalNewUsers",
  "goalRevenue",
  // Startup · dossier du Pre-IC (SP26 « Pre-IC registration »)
  "paidPilots",
  "pipeline",
  // Startup · ajouts proposes (SPECS annexe A)
  "mrr",
  "retention",
  // Batch · exit form (2025)
  "overallSatisfaction",
  "recommendationLikelihood",
  "cofounderFindingEase",
  "tractionSatisfaction",
  "decisionAgreement",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/**
 * @source SP26 « Goal form » (Status). Valeurs et points du pilier Commitment
 * du dashboard actuel : Committed 10, On a project 7, Testing relationships 4,
 * « What am I doing here? » 1.
 */
export const COMMITMENT_STATUSES = ["committed", "on_a_project", "testing_relationships", "what_am_i_doing_here"] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export type FormQuestion = {
  /** Stable pour toute la vie de la question. Un changement de type = un nouvel id. */
  id: string;
  type: FormFieldType;
  label: string;
  description: string | null;
  required: boolean;
  /** Pour `single_choice` et `multiple_choice` ; vide si le champ cible a une liste fermee. */
  options: string[] | null;
  /** Pour `rating` (ex. moral 1-10). */
  scale: { min: number; max: number } | null;
  /** Pour `entity_picker` : quel objet choisir, et combien au plus. */
  picker: { entity: PickerEntity; maxItems: number } | null;
  /**
   * Champ de la base ou ecrire la reponse (brouillon : `dbfield`). `null` : la
   * reponse est toujours « non rattachee » et analysee par le MCP.
   */
  dbField: DbFieldKey | null;
  /** Force (`true`) ou dispense (`false`) la validation pour cette question ; `null` = reglage du formulaire. */
  requiresApproval: boolean | null;
  archived: boolean;
};

/** D'ou vient l'id d'un sujet necessaire aux champs du formulaire. */
export type SubjectSource =
  /** Le fondateur ou la personne qui repond. */
  | { from: "respondent" }
  /** La startup du repondant. */
  | { from: "respondent_startup" }
  /** Un id choisi par le staff a la creation du formulaire. */
  | { from: "fixed"; id: string }
  /** La reponse a une question « choisir un fondateur ». */
  | { from: "question"; questionId: string }
  /** L'evenement auquel le formulaire est rattache (`Form.eventId`). */
  | { from: "form_event" }
  /** La semaine de la date de soumission. */
  | { from: "submission_week" };

/** Rattachement : pour chaque sujet requis par les champs, d'ou vient son id. */
export type FormAttachments = Partial<Record<SubjectKey, SubjectSource>>;

/**
 * Validation avant ecriture (brouillon : `requestApprovalBeforeDb`).
 *   none            tout est ecrit directement
 *   all             tout attend la validation du staff
 *   conflicts_only  seules les valeurs qui remplacent une valeur existante attendent
 */
export type FormApproval = "none" | "all" | "conflicts_only";

/**
 * Identite du repondant (decision du 11/11). Par defaut, sans compte, le
 * repondant CHOISIT son nom dans la liste du batch (jamais un nom tape) ; de
 * meme, une startup, un evenement ou une equipe se choisissent dans une liste
 * (`entity_picker`).
 *   select_name  choix du nom dans la liste (par defaut)
 *   email_code   choix du nom, puis code envoye par email (avis entre pairs)
 *   anonymous    aucune identite (feedback de semaine) : pas de rattachement
 *                a un fondateur, seulement au batch et a l'evenement
 * v2 : liens personnels et formulaires pre-remplis.
 */
export type FormIdentityCheck = "select_name" | "email_code" | "anonymous";

export type FormStatus = "draft" | "open" | "closed";

export type Form = BatchScoped &
  Timestamps &
  Archivable & {
    kind: FormKind;
    title: string;
    description: string | null;
    /** Version courante ; s'incremente a chaque publication d'une modification. */
    version: number;
    questions: FormQuestion[];
    attachments: FormAttachments;
    approval: FormApproval;
    identityCheck: FormIdentityCheck;
    /** Rattache a un evenement (feedback d'exercice, de session, presence). */
    eventId: string | null;
    status: FormStatus;
    opensDateISOString: DateISOString | null;
    deadlineDateISOString: DateISOString | null;
    /** Recurrence (« chaque jeudi a 10h »), au format RRULE. */
    recurrenceRule: string | null;
  };

/** forms/{formId}/versions/{version} : copie figee a chaque publication. */
export type FormVersion = {
  version: number;
  questions: FormQuestion[];
  attachments: FormAttachments;
  approval: FormApproval;
  publishedDateISOString: DateISOString;
};

export type FormAnswer = string | number | boolean | string[] | null;

export type FieldWriteStatus =
  | "applied"
  | "pending_approval"
  | "rejected"
  /** La valeur existante a ete gardee (`fill_empty`) ou est identique. */
  | "unchanged"
  | "invalid";

/** Une ecriture tentee par une reponse : le journal de ce que le formulaire a fait a la base. */
export type FieldWrite = {
  questionId: string;
  dbField: DbFieldKey;
  /** Chemin du document ecrit (ou qui le sera apres validation). */
  path: string;
  value: FormAnswer;
  /** Valeur en place avant l'ecriture, pour la validation et l'annulation. */
  previousValue: FormAnswer;
  status: FieldWriteStatus;
  /** Raison d'un `invalid` ou d'un `rejected`. */
  reason: string | null;
  decidedByUid: string | null;
  decidedDateISOString: DateISOString | null;
};

export type UnmatchedReason = "no_db_field" | "invalid_value" | "unresolved_subject";

/** Une reponse qui n'a pas trouve sa place dans la base : le MCP l'analyse. */
export type UnmatchedAnswer = {
  questionId: string;
  value: FormAnswer;
  reason: UnmatchedReason;
  /** Date de la derniere analyse par Claude ; `null` = pas encore analysee. */
  analyzedDateISOString: DateISOString | null;
};

export type FormResponseStatus = "processed" | "pending_approval" | "partially_rejected";

export type FormResponse = BatchScoped & {
  formId: string;
  /**
   * Copie de `Form.kind`. Les regles s'en servent : les investors IC lisent
   * toutes les reponses SAUF le feedback entre pairs.
   */
  formKind: FormKind;
  formVersion: number;
  /** `null` pour un formulaire anonyme. */
  respondentPersonId: string | null;
  respondentFounderId: string | null;
  /** Les ids resolus pour cette reponse (fondateur, startup, semaine, evenement, equipe). */
  subjects: ResolvedSubjects;
  /** Id de question -> reponse brute. */
  answers: Record<string, FormAnswer>;
  writes: FieldWrite[];
  unmatched: UnmatchedAnswer[];
  status: FormResponseStatus;
  submittedDateISOString: DateISOString;
};

// ---- fieldSuggestions/{suggestionId} -----------------------------------------

/**
 * Proposition de Claude (MCP) pour remplir un champ a partir de texte libre :
 * une reponse non rattachee, une note interne, un texte d'update. Rien n'est
 * ecrit avant acceptation par le staff.
 */
export type FieldSuggestion = BatchScoped &
  Timestamps & {
    source: { kind: "form_response" | "note" | "checkin"; path: string; questionId: string | null };
    dbField: DbFieldKey;
    subjects: ResolvedSubjects;
    value: FormAnswer;
    /** Passage du texte source qui justifie la valeur. */
    quote: string;
    /** 0-1. */
    confidence: number;
    status: "proposed" | "accepted" | "rejected" | "superseded";
    decidedByUid: string | null;
    decidedDateISOString: DateISOString | null;
  };

// ---- completeness/{owner}_{id} -----------------------------------------------

/** Les champs manquants d'un fondateur ou d'une startup (resultat de `listMissingFields`). */
export type Completeness = BatchScoped & {
  owner: TargetKind;
  targetId: string;
  missing: MissingField[];
  /** Part des champs attendus renseignes (0-1). */
  ratio: number;
  computedDateISOString: DateISOString;
};
