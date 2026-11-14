import type { Criterion, EventKind, EventMetric, FormApproval, FormIdentityCheck, FormKind, FormQuestion } from "../types";
import { getFieldDef } from "../fieldRegistry";
import { newQuestion } from "../formRules";
import { defaultPicksQuestion } from "./eventTemplates";
import { CHECKIN_GOALS, CHECKIN_METRICS, withUnit, type CheckinGoalKey, type CheckinMetricKey } from "./standardMetrics";

// ----------------------------
// Modeles de formulaires (SPECS §4.4)
// ----------------------------
// Repris des formulaires Spring 2026 et 2025. A la creation, les questions du
// modele sont COPIEES dans le formulaire : modifier un modele ne change pas un
// formulaire existant (comme les modeles d'evenements).
//
// Une question reliee a un champ de la base (`dbField`) y ecrit sa reponse ;
// les autres restent « non rattachees » et Claude les analyse par le MCP.
// L'onboarding n'est pas un modele ici : il arrive par l'import CSV.
//
// Les formulaires d'un evenement (SPECS §2, modele standard) : la Submission d'un
// hackathon (cle `debrief` : une question par metrique et les champs de l'equipe,
// de portee « son equipe », envoyee avant l'echeance), le Peer rating (l'avis sur
// chaque coequipier, decision du 13/11), le jury (une note par critere, de portee
// « chaque equipe », poids et echelle sur la question), les picks et la retro de
// la semaine. Leurs questions se construisent a partir des reglages par defaut du
// modele d'evenement (`build`), que le staff ajuste ensuite dans l'editeur.

/** La question des avis entre pairs (SPECS §4.3), de 1 a 5. */
const PEER_QUESTION = "Would you start a company with this person?";

/** Les champs d'equipe qu'une Submission peut demander, en plus de ses metriques. */
export const SUBMISSION_FIELDS = ["painSentence", "problemSource", "productUrl", "proofUrls", "learnings", "driveFolderUrl", "notes"] as const;
export type SubmissionFieldKey = (typeof SUBMISSION_FIELDS)[number];
/** Sans choix de l'evenement : les champs d'avant Fall 2026. */
const DEFAULT_SUBMISSION_FIELDS: SubmissionFieldKey[] = ["productUrl", "proofUrls", "notes"];
/** Demandes avant les metriques : ce dont parle l'equipe. */
const LEADING_FIELDS = new Set<SubmissionFieldKey>(["painSentence", "problemSource"]);

/** Une seance a noter dans la retro de la semaine. */
export type RetroSession = { id: string; label: string };

/** Ce dont un modele construit ses questions : l'evenement et ses reglages par defaut. */
export type TemplateContext = {
  eventKind: EventKind | null;
  /** Metriques de la Submission : celles du modele d'evenement, ou donnees a la creation. */
  metrics: EventMetric[];
  /** Grille du jury : celle du modele d'evenement, ou donnee a la creation. */
  criteria: Criterion[];
  /** Champs d'equipe de la Submission, dans l'ordre ; ceux d'avant Fall 2026 sans choix. */
  submissionFields?: readonly SubmissionFieldKey[] | null;
  /** Les seances que la retro fait noter. */
  sessions?: readonly RetroSession[];
};

/**
 * Quand un formulaire d'evenement s'ouvre et jusqu'a quand on peut y repondre a
 * temps (decision du 14/11) : il s'ouvre pendant l'evenement, par defaut 15
 * minutes avant sa fin (on le voit a la conclusion, on ne l'oublie pas), et son
 * echeance tombe 24 h apres son ouverture. Apres l'echeance, il reste ouvert
 * tant que le staff ne le ferme pas ; une reponse en retard compte comme manquee
 * dans Engagement.
 */
export type FormTiming = {
  opens: "start" | "before_end";
  deadline: "before_end" | "day_after_opening" | "none";
};
export const DEFAULT_FORM_TIMING: FormTiming = { opens: "before_end", deadline: "day_after_opening" };

export type FormTemplate = {
  label: string;
  kind: FormKind;
  title: string;
  description: string | null;
  identityCheck: FormIdentityCheck;
  approval: FormApproval;
  /** Le formulaire se rattache a un evenement (feedback d'exercice ou de session, Debrief, jury, picks). */
  needsEvent: boolean;
  /** Il parle de l'equipe du repondant (Submission, Peer rating) : seulement pour un evenement a equipes de travail. */
  needsWorkTeams?: boolean;
  /** Son ouverture et son echeance dans un evenement ; `DEFAULT_FORM_TIMING` sinon. */
  timing?: FormTiming;
  questions: FormQuestion[];
  /** Questions construites depuis l'evenement (Debrief, jury, picks) ; `questions` sinon. */
  build?: (ctx: TemplateContext) => FormQuestion[];
};

/** Les questions d'un modele pour cet evenement. */
export const templateQuestions = (template: FormTemplate, ctx: TemplateContext): FormQuestion[] =>
  (template.build ? template.build(ctx) : template.questions).map((question) => ({ ...question }));

/** Une question de modele. L'id est stable dans le modele ; il est recopie tel quel. */
const q = newQuestion;

const template = (input: Omit<FormTemplate, "approval" | "needsEvent" | "description"> & Partial<FormTemplate>): FormTemplate => ({
  approval: "none",
  needsEvent: false,
  description: null,
  ...input,
});

/** Une metrique du Debrief : un nombre, pour l'equipe, dans `submission.metrics.<cle>` (une cle standard porte sa definition). */
export const metricQuestion = (m: EventMetric): FormQuestion =>
  q(`metric_${m.key}`, { type: "number", label: withUnit(m.label, m.unit), dbField: `submission.metrics.${m.key}` });

/** Un chiffre de l'update du jeudi : libelle (periode, unite) et attente du registre, definition du dictionnaire. */
const checkinQuestion = (key: CheckinMetricKey | CheckinGoalKey): FormQuestion => {
  const dbField = `checkin.${key}` as const;
  const def = getFieldDef(dbField);
  return q(key, { type: "number", label: def.label, dbField, required: def.expected !== null });
};

/** Un critere du jury : une note pour chaque equipe, dans `evaluation.scores.<cle>`, avec son poids. */
export const criterionQuestion = (c: Criterion): FormQuestion =>
  q(`criterion_${c.key}`, {
    type: "rating",
    label: c.label,
    dbField: `evaluation.scores.${c.key}`,
    scale: { min: c.min, max: c.max },
    weight: c.weight,
  });

/** Les questions des champs d'equipe d'une Submission (ids stables : `product`, `proofs`, `notes` d'avant). */
const SUBMISSION_FIELD_QUESTIONS: Record<SubmissionFieldKey, () => FormQuestion> = {
  painSentence: () =>
    q("painSentence", {
      type: "text",
      label: "Pain in one sentence",
      description: "Who has the problem, what it is, how they cope today.",
      dbField: "submission.painSentence",
      required: true,
    }),
  problemSource: () => q("problemSource", { type: "single_choice", label: "Problem", dbField: "submission.problemSource", required: true }),
  productUrl: () => q("product", { type: "link", label: "Product link", dbField: "submission.productUrl" }),
  proofUrls: () =>
    q("proofs", {
      type: "long_text",
      label: "Proof links",
      description: "One link per line: call transcripts, customer list, posts, creatives...",
      dbField: "submission.proofUrls",
    }),
  learnings: () => q("learnings", { type: "long_text", label: "Three things you learned", dbField: "submission.learnings", required: true }),
  driveFolderUrl: () =>
    q("drive", {
      type: "link",
      label: "Your team's Drive folder",
      description: "Every proof lives there. Files changed after the deadline don't count. No proof, no points.",
      dbField: "submission.driveFolderUrl",
      required: true,
    }),
  notes: () => q("notes", { type: "long_text", label: "Anything to add for the Pioneers team?", dbField: "submission.notes" }),
};

export const FORM_TEMPLATES = {
  // La Submission d'un hackathon (SPECS §4.2, decision du 13/11), cle `debrief` :
  // une par equipe, envoyee par le team lead avant l'echeance. Connexion
  // obligatoire : l'equipe est celle du repondant. Le dernier envoi compte ; apres
  // l'echeance, il est marque « en retard ».
  debrief: template({
    label: "Hackathon submission",
    kind: "debrief",
    title: "Submission",
    description:
      "One per team, sent by your team lead before the deadline. Any teammate can send it: the last save counts. A submission after the deadline scores 0.",
    identityCheck: "account",
    needsEvent: true,
    needsWorkTeams: true,
    // Le travail de l'equipe se rend avant la fin du hackathon : la deadline du bareme.
    timing: { opens: "start", deadline: "before_end" },
    questions: [],
    build: ({ metrics, submissionFields }) => {
      const fields = submissionFields ?? DEFAULT_SUBMISSION_FIELDS;
      const fieldQuestion = (key: SubmissionFieldKey) => SUBMISSION_FIELD_QUESTIONS[key]();
      return [
        ...fields.filter((f) => LEADING_FIELDS.has(f)).map(fieldQuestion),
        ...metrics.map(metricQuestion),
        ...fields.filter((f) => !LEADING_FIELDS.has(f)).map(fieldQuestion),
      ];
    },
  }),

  // L'avis sur chaque coequipier (SPECS §4.3, decision du 13/11) : un formulaire a
  // part, le meme pour tout le batch, rempli avant de quitter le debrief.
  peer_rating: template({
    label: "Peer rating",
    kind: "peer_feedback",
    title: "Peer rating",
    description: "30 seconds, one score per teammate. Private: only the Pioneers team reads it.",
    identityCheck: "account",
    needsEvent: true,
    needsWorkTeams: true,
    questions: [
      q("peerRating", {
        type: "rating",
        label: PEER_QUESTION,
        description: "1 = no, 5 = without hesitation.",
        dbField: "peerRating.rating",
        required: true,
      }),
      q("peerComment", { type: "text", label: "Why? (optional)", dbField: "peerRating.comment" }),
    ],
  }),

  // Le jury (SPECS §4.2) : un lien partage, une note par critere pour chaque equipe.
  jury: template({
    label: "Jury",
    kind: "jury",
    title: "Jury",
    description: "Score each team on every criterion. You can come back and correct your scores until the jury is locked.",
    identityCheck: "jury_link",
    needsEvent: true,
    // Les jures notent pendant l'evenement ; le verrou, c'est la fermeture du formulaire.
    timing: { opens: "start", deadline: "none" },
    questions: [],
    build: ({ criteria }) => [
      ...criteria.map(criterionQuestion),
      q("comment", { type: "long_text", label: "Comment for the team", dbField: "evaluation.comment" }),
    ],
  }),

  // Les choix prives et classes (SPECS §4.1) : mutual picks, « qui t'a marque ».
  picks: template({
    label: "Picks",
    kind: "picks",
    title: "Picks",
    description: "Private: only the Pioneers team sees your choices. Your first choice first.",
    identityCheck: "account",
    needsEvent: true,
    questions: [],
    build: ({ eventKind }) => [
      q("picks", {
        type: "entity_picker",
        label: defaultPicksQuestion(eventKind ?? "team_challenge"),
        dbField: "picks.pickedFounderIds",
        picker: { entity: "founder", maxItems: 3 },
        required: true,
      }),
    ],
  }),

  // Semaine 1 : se presenter, dire qui on veut rencontrer (des picks de
  // l'evenement), et son objectif de la semaine.
  founder_introductions: template({
    label: "Founder introductions",
    kind: "motivation",
    title: "Founder introductions",
    identityCheck: "select_name",
    needsEvent: true,
    questions: [
      q("introduceYourself", { type: "long_text", label: "Introduce yourself", dbField: "founderDirectory.introduceYourself", required: true }),
      // Le statut d'engagement des le premier jour (sous-score Commitment, SPECS §5.1).
      q("commitmentStatus", { type: "single_choice", label: "Where are you at?", dbField: "founderWeek.commitmentStatus", required: true }),
      q("meet", {
        type: "entity_picker",
        label: "Founders you would like to meet",
        dbField: "picks.pickedFounderIds",
        picker: { entity: "founder", maxItems: 10 },
      }),
      q("goalForWeek", { type: "long_text", label: "Your goal for the week", dbField: "founderWeek.goalForWeek", required: true }),
    ],
  }),

  // SP26 « Weekly wrap-up » + « goals for next week », passe aux cles standard
  // le 13/11 (presets/standardMetrics.ts) : le pipeline de la semaine, puis les
  // totaux a date. Chaque update porte la startup et le fondateur qui l'a
  // remplie (rattachement automatique) ; ses chiffres sont ceux de la startup.
  weekly_update: template({
    label: "Thursday update",
    kind: "weekly_update",
    title: "Thursday update",
    description: "Your startup's numbers: the whole team, not just you. Put 0 when nothing happened.",
    identityCheck: "select_name",
    questions: [
      ...CHECKIN_METRICS.map(checkinQuestion),
      q("moral", { type: "rating", label: "Morale", dbField: "checkin.moral", required: true }),
      ...CHECKIN_GOALS.map(checkinQuestion),
      q("obstacle", { type: "long_text", label: "Biggest obstacle", dbField: "checkin.obstacle", required: true }),
      q("learned", { type: "long_text", label: "What did you learn from users?", dbField: "checkin.learned" }),
      q("achievement", { type: "long_text", label: "Achievement of the week", dbField: "checkin.achievement" }),
      q("helpNeeded", { type: "long_text", label: "How can the Pioneers team help?", dbField: "checkin.helpNeeded" }),
    ],
  }),

  // Formulaire de motivation hebdomadaire.
  motivation: template({
    label: "Weekly motivation form",
    kind: "motivation",
    title: "Weekly motivation",
    identityCheck: "select_name",
    questions: [
      q("learnings", { type: "long_text", label: "Your 3 learnings of the week", dbField: "founderWeek.learnings", required: true }),
      q("interestedIn", {
        type: "entity_picker",
        label: "Founders you are interested in working with",
        dbField: "founderWeek.interestedInFounderIds",
      }),
      q("goalForWeek", { type: "long_text", label: "Your goal for the week", dbField: "founderWeek.goalForWeek", required: true }),
    ],
  }),

  // SP26 « Goal form ».
  goal: template({
    label: "Goal form",
    kind: "goal",
    title: "Goal form",
    identityCheck: "select_name",
    questions: [
      q("commitmentStatus", {
        type: "single_choice",
        label: "Where are you at?",
        dbField: "founderWeek.commitmentStatus",
        required: true,
      }),
      q("workingWith", { type: "entity_picker", label: "Who are you working with?", dbField: "founderWeek.workingWithFounderIds" }),
      q("projectName", { type: "text", label: "Project name", dbField: "founderWeek.projectName" }),
      q("priority", { type: "long_text", label: "Your priority for the week", dbField: "founderWeek.priorityForWeek", required: true }),
      q("feeling", { type: "long_text", label: "How do you feel?", dbField: "founderWeek.feelingForWeek" }),
      q("anythingSpecific", { type: "long_text", label: "Anything you need from the staff?", dbField: "founderWeek.anythingSpecific" }),
    ],
  }),

  exercise_feedback: template({
    label: "Exercise feedback",
    kind: "exercise_feedback",
    title: "Exercise feedback",
    identityCheck: "select_name",
    needsEvent: true,
    questions: [
      q("useful", { type: "rating", label: "How useful was this exercise?", required: true }),
      q("best", { type: "long_text", label: "What worked best?" }),
      q("change", { type: "long_text", label: "What would you change?" }),
    ],
  }),

  session_feedback: template({
    label: "Session feedback",
    kind: "session_feedback",
    title: "Session feedback",
    identityCheck: "select_name",
    needsEvent: true,
    questions: [
      // La note et le retour vont dans `sessionRatings` (un par fondateur et par seance).
      q("rating", { type: "rating", label: "How was this session?", required: true, dbField: "sessionRating.rating" }),
      q("takeaway", { type: "long_text", label: "Your main takeaway", dbField: "sessionRating.comment" }),
      q("suggestions", { type: "long_text", label: "Suggestions for the speaker or the team" }),
    ],
  }),

  // Feedback de semaine : anonyme, rattache seulement au batch.
  weekly_feedback: template({
    label: "Weekly feedback (anonymous)",
    kind: "custom",
    title: "Weekly feedback",
    description: "Anonymous. Tell us how the week went.",
    identityCheck: "anonymous",
    questions: [
      q("week", { type: "rating", label: "How was your week?", required: true }),
      q("keep", { type: "long_text", label: "What should we keep?" }),
      q("improve", { type: "long_text", label: "What should we improve?" }),
    ],
  }),

  // La retro de fin de semaine (SPECS §4.4, decision du 13/11) : anonyme, 3 minutes
  // sur place. Donnees brutes, aucun champ en base : Claude les analyse.
  week_retro: template({
    label: "Week retro (anonymous)",
    kind: "custom",
    title: "Week retro",
    description: "Anonymous, 3 minutes. Rate each session of the week, then tell us what to keep and what to change.",
    identityCheck: "anonymous",
    needsEvent: true,
    // Rempli sur place, pendant la retro.
    timing: { opens: "start", deadline: "day_after_opening" },
    questions: [],
    build: ({ sessions }) => [
      ...(sessions ?? []).map((s) => q(`session_${s.id}`, { type: "rating", label: s.label })),
      q("sessionsWhy", { type: "long_text", label: "Any session you rated 1 or 2: why?" }),
      q("energy", { type: "rating", label: "Your energy this week", scale: { min: 1, max: 10 }, required: true }),
      q("recommend", { type: "rating", label: "Would you recommend Pioneers to a friend?", scale: { min: 0, max: 10 }, required: true }),
      q("keep", { type: "long_text", label: "One thing to keep" }),
      q("change", { type: "long_text", label: "One thing to change" }),
      q("moreLess", { type: "long_text", label: "What do you want to see more of, or less of?" }),
    ],
  }),

  // Inscription au Selection Day : objectifs, produit, technologie, dossier Drive.
  selection_day_registration: template({
    label: "Selection Day registration",
    kind: "custom",
    title: "Selection Day registration",
    identityCheck: "select_name",
    approval: "conflicts_only",
    questions: [
      q("startupName", { type: "text", label: "Startup name", dbField: "startup.name", required: true }),
      q("oneLiner", { type: "text", label: "One-liner", dbField: "startup.ideaOneLine", required: true }),
      q("goals", { type: "long_text", label: "Your milestones until the IC", dbField: "startupProfile.plannedMilestones" }),
      q("product", { type: "long_text", label: "Product", dbField: "startupProfile.product" }),
      q("technology", { type: "long_text", label: "Technology", dbField: "startupProfile.technology" }),
      q("drive", { type: "link", label: "Drive folder", dbField: "startupProfile.driveFolderUrl", required: true }),
    ],
  }),

  // Inscription au Pre-IC (SP26 « Pre-IC registration »). Pilotes payants et
  // pipeline ne s'y demandent plus : ils viennent de l'update du jeudi (closedWon,
  // payingCustomers, meetingsBooked...).
  pre_ic_registration: template({
    label: "Pre-IC registration",
    kind: "custom",
    title: "Pre-IC registration",
    identityCheck: "select_name",
    approval: "conflicts_only",
    questions: [
      q("goals", { type: "long_text", label: "Your milestones until the IC", dbField: "startupProfile.plannedMilestones" }),
      q("product", { type: "long_text", label: "Product", dbField: "startupProfile.product" }),
      q("technology", { type: "long_text", label: "Technology", dbField: "startupProfile.technology" }),
      q("drive", { type: "link", label: "Drive folder", dbField: "startupProfile.driveFolderUrl", required: true }),
    ],
  }),

  // 2025 « Exit form ». Les notes n'ont pas encore de champ : non rattachees.
  exit: template({
    label: "Exit form",
    kind: "exit",
    title: "Exit form",
    identityCheck: "select_name",
    questions: [
      q("overallSatisfaction", { type: "rating", label: "Overall, how satisfied are you with the program?", scale: { min: 1, max: 10 }, required: true }),
      q("recommendationLikelihood", { type: "rating", label: "How likely are you to recommend Pioneers?", scale: { min: 1, max: 10 }, required: true }),
      q("cofounderFindingEase", { type: "rating", label: "How easy was it to find a co-founder?", scale: { min: 1, max: 10 } }),
      q("tractionSatisfaction", { type: "rating", label: "How satisfied are you with your traction?", scale: { min: 1, max: 10 } }),
      q("decisionAgreement", { type: "rating", label: "How much do you agree with the final decision?", scale: { min: 1, max: 10 } }),
      q("comments", { type: "long_text", label: "Anything else to share?" }),
    ],
  }),
} satisfies Record<string, FormTemplate>;

export type FormTemplateKey = keyof typeof FORM_TEMPLATES;
