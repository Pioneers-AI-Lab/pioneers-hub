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
// Les formulaires d'un evenement (SPECS §2, modele standard) : le Debrief d'un
// hackathon (une question par metrique, de portee « son equipe », et l'avis sur
// chaque coequipier), le jury (une note par critere, de portee « chaque
// equipe », poids sur la question) et les picks. Leurs questions se
// construisent a partir des metriques et de la grille par defaut du modele
// d'evenement (`build`), que le staff ajuste ensuite dans l'editeur.

/** La question des avis entre pairs (SPECS §4.3), de 1 a 5. */
const PEER_QUESTION = "Would you start a company with this person?";

/** Ce dont un modele construit ses questions : l'evenement et ses reglages par defaut. */
export type TemplateContext = {
  eventKind: EventKind | null;
  /** Metriques du Debrief : celles du modele d'evenement, ou donnees a la creation. */
  metrics: EventMetric[];
  /** Grille du jury : celle du modele d'evenement, ou donnee a la creation. */
  criteria: Criterion[];
};

export type FormTemplate = {
  label: string;
  kind: FormKind;
  title: string;
  description: string | null;
  identityCheck: FormIdentityCheck;
  approval: FormApproval;
  /** Le formulaire se rattache a un evenement (feedback d'exercice ou de session, Debrief, jury, picks). */
  needsEvent: boolean;
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
const criterionQuestion = (c: Criterion): FormQuestion =>
  q(`criterion_${c.key}`, {
    type: "rating",
    label: c.label,
    dbField: `evaluation.scores.${c.key}`,
    scale: { min: c.min, max: c.max },
    weight: c.weight,
  });

export const FORM_TEMPLATES = {
  // Le Debrief d'un hackathon (SPECS §4.2, §4.3) : connexion obligatoire (avis
  // prives), reponses retrouvees et modifiables tant qu'il est ouvert.
  debrief: template({
    label: "Hackathon debrief",
    kind: "debrief",
    title: "Debrief",
    description: "Your team's results, then a word on each teammate. One teammate can enter the results for the whole team: the last save counts.",
    identityCheck: "account",
    needsEvent: true,
    questions: [],
    build: ({ metrics }) => [
      ...metrics.map(metricQuestion),
      q("product", { type: "link", label: "Product link", dbField: "submission.productUrl" }),
      q("proofs", {
        type: "long_text",
        label: "Proof links",
        description: "One link per line: call transcripts, customer list, posts, creatives...",
        dbField: "submission.proofUrls",
      }),
      q("notes", { type: "long_text", label: "Anything to add for the Pioneers team?", dbField: "submission.notes" }),
      q("peerRating", {
        type: "rating",
        label: PEER_QUESTION,
        description: "1 = no, 5 = without hesitation. Private: only the Pioneers team reads it.",
        dbField: "peerRating.rating",
        required: true,
      }),
      q("peerComment", { type: "text", label: "One line on this teammate", dbField: "peerRating.comment" }),
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
