import type { DbFieldKey } from "../fieldRegistry";
import type { FormApproval, FormFieldType, FormIdentityCheck, FormKind, FormQuestion, PickerEntity } from "../types";
import { alignQuestionWithField } from "../formRules";

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

export type FormTemplate = {
  label: string;
  kind: FormKind;
  title: string;
  description: string | null;
  identityCheck: FormIdentityCheck;
  approval: FormApproval;
  /** Le formulaire se rattache a un evenement (feedback d'exercice ou de session). */
  needsEvent: boolean;
  questions: FormQuestion[];
};

type QuestionInput = {
  type: FormFieldType;
  label: string;
  dbField?: DbFieldKey;
  required?: boolean;
  description?: string;
  options?: string[];
  scale?: { min: number; max: number };
  picker?: { entity: PickerEntity; maxItems: number };
};

/** Une question de modele. L'id est stable dans le modele ; il est recopie tel quel. */
const q = (id: string, input: QuestionInput): FormQuestion =>
  alignQuestionWithField({
    id,
    type: input.type,
    label: input.label,
    description: input.description ?? null,
    required: input.required ?? false,
    options: input.options ?? null,
    scale: input.scale ?? (input.type === "rating" ? { min: 1, max: 5 } : null),
    picker: input.picker ?? null,
    dbField: input.dbField ?? null,
    requiresApproval: null,
    archived: false,
  });

const template = (input: Omit<FormTemplate, "approval" | "needsEvent" | "description"> & Partial<FormTemplate>): FormTemplate => ({
  approval: "none",
  needsEvent: false,
  description: null,
  ...input,
});

export const FORM_TEMPLATES = {
  // SP26 « Weekly wrap-up » + « goals for next week ». Chaque update porte la
  // startup et le fondateur qui l'a remplie (rattachement automatique).
  weekly_update: template({
    label: "Thursday update",
    kind: "weekly_update",
    title: "Thursday update",
    description: "Your numbers of the week, in two minutes.",
    identityCheck: "select_name",
    questions: [
      q("interviews", { type: "number", label: "Users or customers interviewed this week", dbField: "checkin.interviews", required: true }),
      q("activeUsers", { type: "number", label: "Active users", dbField: "checkin.activeUsers", required: true }),
      q("totalUsers", { type: "number", label: "Total users", dbField: "checkin.totalUsers" }),
      q("revenue", { type: "number", label: "Revenue this week (EUR)", dbField: "checkin.revenue", required: true }),
      q("totalRevenue", { type: "number", label: "Total revenue (EUR)", dbField: "checkin.totalRevenue" }),
      q("outbound", { type: "number", label: "Outbound this week", dbField: "checkin.outbound", required: true }),
      q("featuresShipped", { type: "number", label: "Features shipped", dbField: "checkin.featuresShipped" }),
      q("moral", { type: "rating", label: "Morale", dbField: "checkin.moral", required: true }),
      q("goalOutreach", { type: "number", label: "Goal: outreach next week", dbField: "checkin.goalOutreach" }),
      q("goalInterviews", { type: "number", label: "Goal: interviews next week", dbField: "checkin.goalInterviews" }),
      q("goalNewUsers", { type: "number", label: "Goal: new users next week", dbField: "checkin.goalNewUsers" }),
      q("goalRevenue", { type: "number", label: "Goal: revenue next week (EUR)", dbField: "checkin.goalRevenue" }),
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
      q("rating", { type: "rating", label: "How was this session?", required: true }),
      q("takeaway", { type: "long_text", label: "Your main takeaway" }),
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
  // pipeline n'ont pas encore de champ dans le registre : reponses non rattachees.
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
      q("paidPilots", { type: "number", label: "Paid pilots" }),
      q("pipeline", { type: "number", label: "Pipeline (EUR)" }),
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
