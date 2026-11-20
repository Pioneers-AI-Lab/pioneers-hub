import type { Criterion, EventKind, EventMetric, FormApproval, FormIdentityCheck, FormKind, FormQuestion, PitchStage } from "../types";
import { getFieldDef } from "../fieldRegistry";
import { newQuestion } from "../formRules";
import { isPitchRubric } from "../pitchGrid";
import { TEAM_LOCK_MAX_COFOUNDERS } from "../teamLocks";
import { defaultPicksQuestion } from "./eventTemplates";
import { isOfferedTemplate } from "./offered";
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
  /** L'etape de decision d'un pitch (Selection Day, Pre-IC, IC) : les questions d'apres la grille Pitch en dependent. */
  stage?: PitchStage | null;
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
  /** `two_days_before` : 48 h avant le debut (le Pitch deck, rendu avant le pitch). */
  opens: "start" | "before_end" | "two_days_before";
  /** `day_before` : 24 h avant le debut (la veille du pitch). */
  deadline: "before_end" | "day_after_opening" | "day_before" | "none";
};
export const DEFAULT_FORM_TIMING: FormTiming = { opens: "before_end", deadline: "day_after_opening" };
/** Les formulaires hebdomadaires : au debut de l'entree « Weekly Update Form », echeance 24 h apres. */
const WEEKLY_TIMING: FormTiming = { opens: "start", deadline: "day_after_opening" };

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
  /** Un formulaire par occurrence : son titre porte le jour de l'evenement (« Weekly update · 3 Dec »). */
  datedTitle?: boolean;
  /**
   * Il ecrit la Submission de l'equipe : `true`, un envoi apres son echeance la marque « en retard »
   * (une information, elle compte depuis le 18/11) ; `false`, ce retard ne compte que dans
   * « Forms on time » (Plan et Snapshot du H5).
   * Recopie sur le formulaire (`Form.setsSubmissionLate`, absent = `true`).
   */
  setsSubmissionLate?: boolean;
  questions: FormQuestion[];
  /** Questions construites depuis l'evenement (Debrief, jury, picks) ; `questions` sinon. */
  build?: (ctx: TemplateContext) => FormQuestion[];
  /** La description, si elle depend de l'evenement (le jury d'un pitch) ; `description` sinon. */
  describe?: (ctx: TemplateContext) => string | null;
  /**
   * Plus propose au staff (decision du 17/11, docs/FONCTIONNALITES.md §4.6) :
   * le modele reste lu par les formulaires deja crees, mais on n'en cree plus.
   */
  retired?: boolean;
};

/** Un modele retire n'est plus propose : `isOfferedTemplate` (presets/offered.ts). */
export { isOfferedTemplate };

/** La description d'un modele pour cet evenement. */
export const templateDescription = (template: FormTemplate, ctx: TemplateContext): string | null => template.describe?.(ctx) ?? template.description;

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

/**
 * Les chiffres du Weekly update startup (§2.9), dans l'ordre de l'update : le pipeline de la semaine,
 * puis les totaux a date. Sans `featuresShipped` ni les objectifs chiffres de l'ancien Thursday update.
 */
const WEEKLY_STARTUP_NUMBERS = CHECKIN_METRICS.filter((key) => key !== "featuresShipped");

/** Un chiffre de l'update du jeudi : libelle (periode, unite) et attente du registre, definition du dictionnaire. */
const checkinQuestion = (key: CheckinMetricKey | CheckinGoalKey): FormQuestion => {
  const dbField = `checkin.${key}` as const;
  const def = getFieldDef(dbField);
  return q(key, { type: "number", label: def.label, dbField, required: def.expected !== null });
};

/** Un critere du jury : une note pour chaque equipe, dans `evaluation.scores.<cle>`, avec son poids (aucun pour un departage). */
export const criterionQuestion = (c: Omit<Criterion, "weight"> & Pick<FormQuestion, "weight">): FormQuestion =>
  q(`criterion_${c.key}`, {
    type: "rating",
    label: c.label,
    dbField: `evaluation.scores.${c.key}`,
    scale: { min: c.min, max: c.max },
    weight: c.weight,
  });

/**
 * Apres les criteres de la grille Pitch (lot 5, §2.11) : la note globale vient en dernier (« mediating
 * assessments protocol »). Decision au Selection Day, au Pre-IC et a l'IC ; Would you invest? et How likely
 * avant l'IC. Affiches, jamais comptes. Le commentaire suit (`jury`).
 */
const pitchVerdictQuestions = (stage: PitchStage | null): FormQuestion[] => [
  q("overall", {
    type: "rating",
    label: "Overall",
    description: "Your global score, now that every criterion is scored: 0 nothing, 3 what we expect, 5 exceptional.",
    dbField: "evaluation.overallScore",
  }),
  ...(stage ? [q("decision", { type: "single_choice", label: "Decision", dbField: "evaluation.decision" })] : []),
  ...(stage !== "ic"
    ? [
        q("wouldInvest", { type: "single_choice", label: "Would you invest?", dbField: "evaluation.wouldInvest" }),
        q("betLikelihood", {
          type: "rating",
          label: "How likely is this the one team you'd bet on?",
          description: "0 = not at all, 5 = this is the one.",
          dbField: "evaluation.betLikelihood",
        }),
      ]
    : []),
];

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

/** Ce que partagent les trois formulaires d'equipe du H5 : comme la Submission, d'equipe, depuis son compte. */
const h5TeamForm = (input: Pick<FormTemplate, "label" | "title" | "description" | "setsSubmissionLate" | "questions" | "build">): FormTemplate =>
  template({
    kind: "debrief",
    identityCheck: "account",
    needsEvent: true,
    needsWorkTeams: true,
    timing: { opens: "start", deadline: "before_end" },
    ...input,
  });
const H5_ANY_TEAMMATE = "Any teammate can send it; the last save counts.";

export const FORM_TEMPLATES = {
  // La Submission d'un hackathon (SPECS §4.2, decision du 13/11), cle `debrief` :
  // une par equipe. Le team lead s'assure qu'elle part avant l'echeance ; tout
  // coequipier peut l'envoyer. Connexion obligatoire : l'equipe est celle du
  // repondant. Le dernier envoi compte ; apres l'echeance, il est marque « en
  // retard » (une information pour le staff et le jury : il compte, 18/11).
  debrief: template({
    label: "Hackathon submission",
    kind: "debrief",
    title: "Submission",
    description:
      "One per team. Your team lead makes sure it is sent before the deadline; any teammate can send it, and the last save counts.",
    identityCheck: "account",
    needsEvent: true,
    needsWorkTeams: true,
    // Le travail de l'equipe se rend avant la fin du hackathon : la deadline du bareme.
    timing: { opens: "start", deadline: "before_end" },
    setsSubmissionLate: true,
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

  // Le H5 (docs/FONCTIONNALITES.md §2.6) : trois formulaires d'equipe au lieu
  // d'une Submission, qui ecrivent la MEME soumission (`submissions/{teamId}`) a trois moments.
  // Comme `debrief` : une reponse par equipe, depuis son compte, tout coequipier l'envoie, le
  // dernier envoi compte. Dates de data/events.json (`formSettings`). Seul Final numbers en
  // retard marque la Submission « en retard » (`setsSubmissionLate`, une information) ; Plan et
  // Snapshot en retard ne comptent que dans « Forms on time ».
  h5_plan: h5TeamForm({
    label: "H5 plan",
    title: "Plan H5",
    description: `One per team: the problem you chose, your customer and your plan. ${H5_ANY_TEAMMATE}`,
    setsSubmissionLate: false,
    questions: [
      q("plan", {
        type: "long_text",
        label: "Problem, customer, one-page plan",
        description: "The problem you solve, who pays for it, and how you get your first customer by Monday.",
        dbField: "submission.notes",
        required: true,
      }),
      q("planLink", { type: "link", label: "Link to your one-page plan", dbField: "submission.slideUrl" }),
    ],
  }),

  h5_snapshot: h5TeamForm({
    label: "H5 snapshot",
    title: "Snapshot H5",
    description: `One per team, at the build freeze: what is online and what you shipped. ${H5_ANY_TEAMMATE}`,
    setsSubmissionLate: false,
    questions: [
      { ...SUBMISSION_FIELD_QUESTIONS.productUrl(), label: "Product URL", required: true },
      q("demo", { type: "link", label: "2-minute demo", description: "A Loom or any video link.", dbField: "submission.videoUrl" }),
      q("features", { type: "long_text", label: "Features shipped", dbField: "submission.features", required: true }),
    ],
  }),

  h5_final: h5TeamForm({
    label: "H5 final numbers",
    title: "Final numbers H5",
    description: `One per team: your numbers when sales stop counting. ${H5_ANY_TEAMMATE}`,
    setsSubmissionLate: true,
    questions: [],
    // Les metriques de l'evenement (`submission.metrics.<cle>`), puis le dossier Drive des preuves.
    build: ({ metrics }) => [...metrics.map(metricQuestion), SUBMISSION_FIELD_QUESTIONS.driveFolderUrl()],
  }),

  // L'avis sur chaque coequipier (SPECS §4.3, decision du 13/11) : un formulaire a
  // part, le meme pour tout le batch, rempli avant de quitter le debrief. Deux notes
  // (18/11) : le ressenti compte dans Likability (4 ou 5), la fiabilite dans Execution.
  peer_rating: template({
    label: "Peer rating",
    kind: "peer_feedback",
    title: "Peer rating",
    description: "30 seconds, two scores per teammate. Private: only the Pioneers team reads it.",
    identityCheck: "account",
    needsEvent: true,
    needsWorkTeams: true,
    questions: [
      q("peerLikability", {
        type: "rating",
        label: "How did you feel working with this person?",
        description: "1 = badly, 5 = great.",
        dbField: "peerRating.likability",
        required: true,
      }),
      q("peerReliability", {
        type: "rating",
        label: "How reliable was this person in delivering on commitments?",
        description: "1 = not at all, 5 = completely.",
        dbField: "peerRating.reliability",
        required: true,
      }),
      q("peerComment", { type: "text", label: "Why? (optional)", dbField: "peerRating.comment" }),
    ],
  }),

  // Le jury (SPECS §4.2) : un lien partage, une note par critere pour chaque equipe. Pour la grille
  // Pitch (lot 5, shared/pitchGrid.ts), les questions d'apres la grille suivent les criteres.
  jury: template({
    label: "Jury",
    kind: "jury",
    title: "Jury",
    // Echelle commune (decision du 17/11) : la grille fait 100 points, chaque critere est note de 0 a 5.
    description:
      "Read each team's submission and check the proofs in its Drive folder, then score every criterion from 0 to 5: 0 nothing (or nothing you can check), 3 what we expect, 5 exceptional. For a number, 5 is the best team. Score on your own, before any discussion. You can come back and correct your scores until the jury is locked.",
    describe: ({ criteria }) =>
      isPitchRubric(criteria)
        ? "Read each startup's pitch deck, then score every criterion from 0 to 5 on your own, before any discussion: 0 nothing (or nothing you can check), 3 what we expect, 5 exceptional. Give your overall score last. You can come back and correct your scores until the jury is locked."
        : null,
    identityCheck: "jury_link",
    needsEvent: true,
    // Les jures notent pendant l'evenement ; le verrou, c'est la fermeture du formulaire.
    timing: { opens: "start", deadline: "none" },
    questions: [],
    build: ({ criteria, stage }) => [
      ...criteria.map(criterionQuestion),
      ...(isPitchRubric(criteria) ? pitchVerdictQuestions(stage ?? null) : []),
      q("comment", { type: "long_text", label: "Comment for the team", dbField: "evaluation.comment" }),
    ],
  }),

  // Le Pitch deck (lot 5, §2.11) : une reponse par startup, envoyee par n'importe quel fondateur
  // depuis son compte (« fait » pour toute la startup, comme le Weekly update startup : toutes ses
  // questions ecrivent la startup). Il s'ouvre 48 h avant le pitch, echeance la veille ; ses
  // reponses vont dans la fiche de la startup, que le jury lit (`loadJuryBrief`).
  pitch_deck: template({
    label: "Pitch deck",
    kind: "custom",
    title: "Pitch deck",
    description: "One per startup: any co-founder sends it, the last save counts. Due the day before the pitch: the jury reads it before you pitch.",
    identityCheck: "account",
    needsEvent: true,
    timing: { opens: "two_days_before", deadline: "day_before" },
    questions: [
      q("pitchDeck", { type: "link", label: "Pitch deck", description: "A link anyone with it can open (Google Slides, Pitch, PDF on Drive).", dbField: "startupProfile.pitchDeckUrl", required: true }),
      q("oneLiner", { type: "text", label: "One-liner", dbField: "startup.ideaOneLine", required: true }),
      q("problem", { type: "long_text", label: "Problem", dbField: "startupProfile.problem", required: true }),
      q("icp", { type: "long_text", label: "Customer (ICP)", description: "Who buys, and who uses it if not the same.", dbField: "startupProfile.icp", required: true }),
      q("solution", { type: "long_text", label: "Solution", dbField: "startupProfile.solution", required: true }),
      q("whyNow", { type: "long_text", label: "Why now?", dbField: "startupProfile.whyNow", required: true }),
    ],
  }),

  // Les choix prives et classes (SPECS §4.1) : mutual picks, « qui t'a marque ».
  picks: template({
    retired: true,
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
  // l'evenement), et son objectif de la semaine. Connexion obligatoire (decision
  // du 15/11) : il ecrit la presentation et les picks du repondant.
  founder_introductions: template({
    retired: true,
    label: "Founder introductions",
    kind: "motivation",
    title: "Founder introductions",
    identityCheck: "account",
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
  // le 13/11 (presets/standardMetrics.ts). Retire le 17/11 : le Weekly update startup le remplace
  // (et le Weekly update founder), crees sur chaque entree « Weekly Update Form » de l'agenda.
  weekly_update: template({
    retired: true,
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

  // ---- Lot 4 : les formulaires hebdomadaires (docs/FONCTIONNALITES.md §2.8, §2.9) ----
  // Le pack `weekly_update` (presets/eventTemplates.ts) de chaque entree « Weekly Update Form » de l'agenda
  // (decision du 18/11, shared/weeklyForms.ts) : depuis son compte, ouverts a son debut, echeance 24 h
  // apres, le jour dans le titre. Un formulaire par semaine : ses reponses vont dans la semaine ou il
  // ouvre. Revus par le staff dans Admin > Reviews (shared/weeklyReviews.ts).

  // Le Weekly update founder : la page rappelle l'objectif donne la semaine d'avant au-dessus de
  // « What did you achieve? » (`getPublicForm` : `previousGoal`). Shortlist et « Met » ne se
  // redemandent pas : le jure les voit a cote de la reponse.
  weekly_update_founder: template({
    label: "Weekly update founder",
    kind: "motivation",
    title: "Weekly update",
    description: "5 minutes. Your week against the goal you gave last week, your goal for next week, your problem validation and your co-founder search.",
    identityCheck: "account",
    timing: WEEKLY_TIMING,
    datedTitle: true,
    questions: [
      q("achieved", { type: "long_text", label: "What did you achieve?", dbField: "founderWeek.achieved", required: true }),
      q("goalForWeek", { type: "long_text", label: "Your goal for next week", dbField: "founderWeek.goalForWeek", required: true }),
      q("commitmentStatus", { type: "single_choice", label: "Where are you at?", dbField: "founderWeek.commitmentStatus", required: true }),
      q("messagesSent", { type: "number", label: "Problem validation: messages sent", description: "This week. Put 0 if none.", dbField: "founderWeek.messagesSent", required: true }),
      q("conversationsDone", {
        type: "number",
        label: "Problem validation: conversations with potential users",
        description: "This week: real conversations of 60 seconds or more. Put 0 if none.",
        dbField: "founderWeek.conversationsDone",
        required: true,
      }),
      q("learnings", { type: "long_text", label: "Problem validation: what did you learn?", dbField: "founderWeek.learnings" }),
      q("workingWith", {
        type: "entity_picker",
        label: "Cofounder matching: active discussions",
        description: "The founders you are talking with about building together.",
        dbField: "founderWeek.workingWithFounderIds",
        picker: { entity: "founder", maxItems: 10 },
      }),
      q("matchResult", { type: "single_choice", label: "Cofounder matching: result", dbField: "founderWeek.matchResult", required: true }),
    ],
  }),

  // Le Weekly update startup (l'update du jeudi, decision du 13/11) : les chiffres de TOUTE la
  // startup. Une reponse par startup, envoyee par n'importe quel membre (« fait » pour tous :
  // `formNeedsStartup`) ; chaque chiffre affiche sa definition (SPECS annexe A.5).
  weekly_update_startup: template({
    label: "Weekly update startup",
    kind: "weekly_update",
    title: "Weekly update startup",
    description: "One per startup: any co-founder sends it. Your startup's numbers, the whole team, not just you. Put 0 when nothing happened.",
    identityCheck: "account",
    timing: WEEKLY_TIMING,
    datedTitle: true,
    questions: [
      q("achievement", { type: "long_text", label: "What did you achieve this week?", dbField: "checkin.achievement", required: true }),
      q("goals", { type: "long_text", label: "Goals for next week", dbField: "checkin.goals", required: true }),
      ...WEEKLY_STARTUP_NUMBERS.map(checkinQuestion),
      q("obstacle", { type: "long_text", label: "Biggest obstacle", dbField: "checkin.obstacle", required: true }),
      q("learned", { type: "long_text", label: "What did you learn?", dbField: "checkin.learned" }),
      q("helpNeeded", { type: "long_text", label: "How can the staff help?", dbField: "checkin.helpNeeded" }),
    ],
  }),

  // Formulaire de motivation hebdomadaire.
  motivation: template({
    retired: true,
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
    retired: true,
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
    retired: true,
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
    retired: true,
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
    retired: true,
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

  // La retro de fin de semaine (SPECS §4.4) : 3 minutes sur place. Depuis le 17/11, depuis son
  // compte comme tout formulaire de fondateur (plus d'anonyme), et trois blocs seulement : l'energie,
  // chaque seance, plus ou moins de quoi. « Recommend », « keep » et « change » passent a la fin du
  // programme. Donnees brutes, aucun champ en base : Claude les analyse.
  week_retro: template({
    label: "Week retro",
    kind: "custom",
    title: "Week retro",
    description: "3 minutes. Your energy this week, a score for each session, and what you want more or less of.",
    identityCheck: "account",
    needsEvent: true,
    // Rempli sur place, pendant la retro.
    timing: { opens: "start", deadline: "day_after_opening" },
    questions: [],
    build: ({ sessions }) => [
      q("energy", { type: "rating", label: "Your energy this week", scale: { min: 1, max: 10 }, required: true }),
      ...(sessions ?? []).map((s) => q(`session_${s.id}`, { type: "rating", label: s.label })),
      q("sessionsWhy", { type: "long_text", label: "Any session you rated 1 or 2: why?" }),
      q("moreLess", { type: "long_text", label: "What do you want to see more of, or less of?" }),
    ],
  }),

  // Lock my team (lot 2, docs/FONCTIONNALITES.md §2.10) : chacun dit s'il
  // verrouille une equipe pour le H5, avec qui et sous quel nom. Rattache au BATCH, pas a un
  // evenement : il s'adresse a tous les fondateurs, absents du debrief du H4 compris. Depuis
  // son compte ; on peut y repondre « non ». Le staff en tire les startups (Admin > Startups).
  lock_my_team: template({
    label: "Lock my team",
    kind: "custom",
    title: "Lock my team",
    description:
      "Everyone answers, even without a team. If you lock a team, pick your co-founders: the Pioneers team creates your startup when every co-founder picks the same team. Otherwise you are drawn into a team for Hackathon 5.",
    identityCheck: "account",
    questions: [
      q("locked", { type: "single_choice", label: "Do you lock a team?", dbField: "teamLock.locked", required: true }),
      q("coFounders", {
        type: "entity_picker",
        label: "Your co-founders",
        description: `If you lock a team: every co-founder in the batch, up to ${TEAM_LOCK_MAX_COFOUNDERS}.`,
        dbField: "teamLock.coFounderIds",
        picker: { entity: "founder", maxItems: TEAM_LOCK_MAX_COFOUNDERS },
      }),
      q("startupName", { type: "text", label: "Startup name", description: "If you lock a team. Optional.", dbField: "teamLock.startupName" }),
    ],
  }),

  // Inscription au Selection Day : objectifs, produit, technologie, dossier Drive. Retiree le 17/11 :
  // absente du document, le Pitch deck de chaque pitch (Selection Day compris) la remplace.
  selection_day_registration: template({
    retired: true,
    label: "Selection Day registration",
    kind: "custom",
    title: "Selection Day registration",
    identityCheck: "account",
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
  // payingCustomers, meetingsBooked...). Retiree le 17/11, comme celle du Selection Day : le Pitch deck.
  pre_ic_registration: template({
    retired: true,
    label: "Pre-IC registration",
    kind: "custom",
    title: "Pre-IC registration",
    identityCheck: "account",
    approval: "conflicts_only",
    questions: [
      q("goals", { type: "long_text", label: "Your milestones until the IC", dbField: "startupProfile.plannedMilestones" }),
      q("product", { type: "long_text", label: "Product", dbField: "startupProfile.product" }),
      q("technology", { type: "long_text", label: "Technology", dbField: "startupProfile.technology" }),
      q("drive", { type: "link", label: "Drive folder", dbField: "startupProfile.driveFolderUrl", required: true }),
    ],
  }),

  // 2025 « Exit form » : remplace par Program end (decision du 17/11).
  exit: template({
    retired: true,
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

  // Program end (lot 4, §2.12) : a la fin du programme, depuis son compte, trois questions sans
  // champ en base (Feedback, analyse par Claude). « Recommend », « keep » et « change » viennent de la retro.
  program_end: template({
    label: "Program end",
    kind: "exit",
    title: "Program end",
    description: "2 minutes, at the end of the program. Your answers help us shape the next batch.",
    identityCheck: "account",
    questions: [
      q("recommend", { type: "rating", label: "Would you recommend Pioneers?", description: "0 = not at all, 10 = without hesitation.", scale: { min: 0, max: 10 }, required: true }),
      q("keep", { type: "long_text", label: "One thing to keep", required: true }),
      q("change", { type: "long_text", label: "One thing to change", required: true }),
    ],
  }),
} satisfies Record<string, FormTemplate>;

export type FormTemplateKey = keyof typeof FORM_TEMPLATES;

/** Les modeles encore proposes (ni retires, `isOfferedTemplate`), dans l'ordre du catalogue : Admin > Forms > New, `create_form` (enum). */
export const OFFERED_FORM_TEMPLATE_KEYS = (Object.keys(FORM_TEMPLATES) as FormTemplateKey[]).filter((key) => isOfferedTemplate(FORM_TEMPLATES[key])) as [
  FormTemplateKey,
  ...FormTemplateKey[],
];
