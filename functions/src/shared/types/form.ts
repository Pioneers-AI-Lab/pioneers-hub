import { CHECKIN_GOALS, CHECKIN_METRICS } from "../presets/standardMetrics";
import type { DbFieldKey, MissingField, ResolvedSubjects, SubjectKey } from "../fieldRegistry";
import type { Archivable, BatchScoped, DateISOString, TargetKind, Timestamps } from "./common";

// ----------------------------
// Formulaires (SPECS §4.4, brouillon du 11/11)
// ----------------------------
//   forms/{formId}                       Form             public (lien partage)
//   forms/{formId}/versions/{version}    FormVersion      public
//   formResponses/{responseId}           FormResponse     staff seulement (reponses brutes)
//   formCompletions/{formId}_{founderId} FormCompletion   le fondateur lui-meme + staff (« To do »)
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
//
// LE MODELE STANDARD (SPECS §2, decision du 12/11) : toute saisie d'un evenement
// est un formulaire rattache a l'evenement. Chaque question a une PORTEE
// (`scope`) : le repondant, son equipe, chaque coequipier, chaque equipe notee.
// Le Debrief d'un hackathon, le jury et les picks sont des formulaires comme les
// autres ; leurs reponses s'ecrivent dans les documents types (`submissions`,
// `peerRatings`, `evaluations`, `picks`) par le registre.

export type FormKind =
  | "onboarding"
  | "motivation"
  | "goal"
  | "weekly_update"
  | "exercise_feedback"
  | "session_feedback"
  | "peer_feedback"
  /** Resultats d'equipe et avis entre pairs apres un hackathon. */
  | "debrief"
  /** Notes du jury, une par critere et par equipe. */
  | "jury"
  /** Choix prives et classes (mutual picks, « qui t'a marque »). */
  | "picks"
  | "exit"
  | "custom";

/**
 * Les 7 types de la spec (le lien et le fichier sont separes, le texte long aussi).
 * `entity_picker` : choisir un objet dans une liste (fondateur, startup, evenement,
 * equipe, mentor), jamais un nom tape.
 */
export const FORM_FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "rating",
  "single_choice",
  "multiple_choice",
  "entity_picker",
  "link",
  "file",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Ce que propose une question `entity_picker`. */
export const PICKER_ENTITIES = ["founder", "startup", "event", "team", "mentor"] as const;
export type PickerEntity = (typeof PICKER_ENTITIES)[number];

/**
 * Indicateurs NUMERIQUES traces en courbe (`kpiSeries`, `portfolioReports`).
 * Un champ du registre en est un quand son `indicator` est renseigne ; les
 * textes de l'update (objectifs, obstacle...) n'en sont pas.
 */
export const METRIC_KEYS = [
  // Startup · update du jeudi : pipeline de la semaine, totaux a date, moral, objectifs (presets/standardMetrics.ts)
  ...CHECKIN_METRICS,
  "moral",
  ...CHECKIN_GOALS,
  // Startup · historique Spring 2026 (revenu de definition inconnue : ni renomme ni plus demande)
  "revenue",
  "totalRevenue",
  // Startup · ajouts proposes (SPECS annexe A)
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
export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  committed: "Committed to a startup",
  on_a_project: "On a project, not committed",
  testing_relationships: "Testing relationships",
  what_am_i_doing_here: "What am I doing here?",
};

/**
 * La portee d'une question : de quoi la reponse parle.
 *   self           le repondant (une reponse)
 *   team           son equipe publiee a l'evenement du formulaire (une reponse
 *                  commune, partagee par l'equipe : le dernier envoi fait foi)
 *   each_teammate  chaque coequipier (une reponse par coequipier : avis entre pairs)
 *   each_target    chaque equipe notee (ou startup, selon la mecanique), sauf la
 *                  sienne (une reponse par cible : notes du jury)
 * Les deux dernieres sont « par cible » : la reponse se range sous
 * `answerKey(questionId, targetId)`.
 */
export const QUESTION_SCOPES = ["self", "team", "each_teammate", "each_target"] as const;
export type QuestionScope = (typeof QUESTION_SCOPES)[number];

/**
 * Ce que chaque portee implique, en un seul endroit :
 *   perTarget  la question se repete par cible (reponse sous `answerKey`)
 *   needsTeam  il faut etre membre d'une equipe publiee de l'evenement
 */
export const SCOPE_RULES: Record<QuestionScope, { perTarget: boolean; needsTeam: boolean }> = {
  self: { perTarget: false, needsTeam: false },
  team: { perTarget: false, needsTeam: true },
  each_teammate: { perTarget: true, needsTeam: true },
  each_target: { perTarget: true, needsTeam: false },
};

/** Une portee qui repete la question pour chaque cible (coequipier, equipe notee). */
export const isPerTarget = (scope: QuestionScope): scope is "each_teammate" | "each_target" => SCOPE_RULES[scope].perTarget;

/** La portee d'une question ; `self` pour une question d'avant les portees. */
export const scopeOf = (q: Pick<FormQuestion, "scope">): QuestionScope => q.scope ?? "self";

/** La cle d'une reponse : l'id de la question, suivi de la cible pour une question par cible. */
export const answerKey = (questionId: string, targetId: string | null) => (targetId ? `${questionId}@${targetId}` : questionId);

/** L'inverse d'`answerKey`. */
export function parseAnswerKey(key: string): { questionId: string; targetId: string | null } {
  const at = key.indexOf("@");
  return at < 0 ? { questionId: key, targetId: null } : { questionId: key.slice(0, at), targetId: key.slice(at + 1) };
}

/** Les questions actives (non archivees) d'un formulaire. */
export const activeQuestions = <Q extends Pick<FormQuestion, "archived">>(form: { questions: readonly Q[] }): Q[] => form.questions.filter((q) => !q.archived);

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
  /** De quoi parle la reponse (`self` si absent : questions d'avant les portees). */
  scope?: QuestionScope;
  /**
   * Poids d'un critere du jury (question de note reliee a `evaluation.scores.<cle>`),
   * dans la moyenne ponderee du leaderboard (40 / 40 / 20 pour l'IC). `null` : 1.
   */
  weight?: number | null;
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
  /** L'equipe publiee du repondant a l'evenement du formulaire. */
  | { from: "respondent_team" }
  /** La cible d'une question par cible (coequipier ou equipe notee). */
  | { from: "target" }
  /**
   * La semaine du formulaire : celle de son ouverture (`opensDateISOString`,
   * posee a la publication). Une reponse tardive reste dans la semaine du
   * formulaire. Le nom date d'avant la decision « un formulaire par occurrence ».
   */
  | { from: "submission_week" };

/** Rattachement : pour chaque sujet requis par les champs, d'ou vient son id. */
export type FormAttachments = Partial<Record<SubjectKey, SubjectSource>>;

/**
 * Validation avant ecriture (brouillon : `requestApprovalBeforeDb`).
 *   none            tout est ecrit directement
 *   all             tout attend la validation du staff
 *   conflicts_only  seules les valeurs qui remplacent une valeur existante attendent
 */
export const FORM_APPROVALS = ["none", "all", "conflicts_only"] as const;
export type FormApproval = (typeof FORM_APPROVALS)[number];

/**
 * Identite du repondant (decisions du 11/11 et du 12/11). Par defaut, sans
 * compte, le repondant CHOISIT son nom dans la liste du batch (jamais un nom
 * tape) ; de meme, une startup, un evenement ou une equipe se choisissent dans
 * une liste (`entity_picker`).
 *   select_name  choix du nom dans la liste (par defaut)
 *   account      connexion obligatoire : le compte rattache au batch repond en
 *                son nom ; il retrouve ses reponses et les modifie tant que le
 *                formulaire est ouvert (Debrief, picks)
 *   email_code   ancien nom d'`account` (en attendant un code par email), lu pareil
 *   jury_link    lien partage a secret (`events/{id}/judges/link`), sans compte :
 *                le jure choisit ou saisit son nom (`judgeId` stable)
 *   anonymous    aucune identite (feedback de semaine) : pas de rattachement
 *                a un fondateur, seulement au batch et a l'evenement
 * v2 : liens personnels.
 */
export const FORM_IDENTITY_CHECKS = ["select_name", "account", "email_code", "jury_link", "anonymous"] as const;
export type FormIdentityCheck = (typeof FORM_IDENTITY_CHECKS)[number];

/**
 * Ce que chaque identite implique, en un seul endroit :
 *   respondent    qui repond : un fondateur du batch, un jure, ou personne
 *   proven        l'identite est prouvee (compte, secret du lien) : le formulaire
 *                 rend les reponses deja donnees, qui se corrigent
 *   needsAccount  la connexion est exigee
 */
export const IDENTITY_RULES: Record<FormIdentityCheck, { respondent: "founder" | "judge" | "none"; proven: boolean; needsAccount: boolean }> = {
  select_name: { respondent: "founder", proven: false, needsAccount: false },
  account: { respondent: "founder", proven: true, needsAccount: true },
  email_code: { respondent: "founder", proven: true, needsAccount: true },
  jury_link: { respondent: "judge", proven: true, needsAccount: false },
  anonymous: { respondent: "none", proven: false, needsAccount: false },
};

/** L'identite est prouvee (compte connecte, ou lien secret du jury) : le formulaire peut rendre les reponses deja donnees. */
export const isProvenIdentity = (identity: FormIdentityCheck) => IDENTITY_RULES[identity].proven;

/** La connexion est exigee. */
export const needsAccount = (identity: FormIdentityCheck) => IDENTITY_RULES[identity].needsAccount;

/** Le repondant est un jure (lien de jury). */
export const isJuryForm = (form: Pick<Form, "identityCheck">) => IDENTITY_RULES[form.identityCheck].respondent === "judge";

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
  /** La cible d'une question par cible (coequipier, equipe notee) ; absent ou `null` sinon. */
  targetId?: string | null;
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
  /** Copie de `Form.kind`. */
  formKind: FormKind;
  formVersion: number;
  /** `null` pour un formulaire anonyme. */
  respondentPersonId: string | null;
  respondentFounderId: string | null;
  /** Le jure d'un formulaire `jury_link` (`founder-{id}` ou `jury-{empreinte}`) et son nom ; absent sinon. */
  respondentJudgeId?: string | null;
  respondentName?: string | null;
  /** Les ids resolus pour cette reponse (fondateur, startup, semaine, evenement, equipe), hors cible. */
  subjects: ResolvedSubjects;
  /** `answerKey(question, cible)` -> reponse brute. */
  answers: Record<string, FormAnswer>;
  /** Le nom de chaque cible repondue (coequipier, equipe notee), pour relire la reponse. Absent sinon. */
  targetNames?: Record<string, string>;
  writes: FieldWrite[];
  unmatched: UnmatchedAnswer[];
  status: FormResponseStatus;
  submittedDateISOString: DateISOString;
};

// ---- formCompletions/{formId}_{founderId} --------------------------------------

/**
 * « J'ai repondu a ce formulaire » : ce que lit le « To do » du fondateur, qui
 * ne peut pas lire `formResponses` (staff). Ecrit par `submitFormResponse` dans
 * la meme transaction que la reponse ; lu par le fondateur lui-meme et le staff.
 * Par formulaire : pas de formulaire recurrent (decision du 12/11), l'update de
 * chaque semaine est son propre formulaire, donc « fait » vaut pour sa semaine.
 * Jamais pour un formulaire anonyme (le rattacher au fondateur le trahirait).
 */
export type FormCompletion = BatchScoped & {
  formId: string;
  founderId: string;
  formKind: FormKind;
  /** Derniere reponse envoyee (une page rouverte et renvoyee la remplace) : l'information. */
  responseId: string;
  completedDateISOString: DateISOString;
  /** Premiere reponse : c'est elle qui compte pour « rempli a temps » (Engagement, decision du 14/11). Absente des plus anciennes. */
  firstCompletedDateISOString?: DateISOString;
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
