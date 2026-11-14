// ----------------------------
// Metriques standard : pipeline et traction (SPECS annexe A.5, decision du 13/11)
// ----------------------------
// LE dictionnaire des cles de metriques. Une meme notion porte la meme cle
// partout : update du jeudi (`checkin.<cle>`), Debrief des hackathons
// (`submission.metrics.<cle>`), releves (`metricSnapshots.metric`). Les
// hackathons se comparent ainsi entre eux, d'un batch a l'autre, et a l'update.
//
// Nomenclature :
//   - un FLUX se compte sur une periode (la semaine de l'update, ou la duree de
//     l'evenement) ; sa cle finit par un participe passe : `callsMade`,
//     `conversationsDone`, `accountsCreated` ;
//   - un TOTAL se lit a une date ; sa cle n'a pas de participe : `totalUsers`,
//     `activeUsers`, `payingCustomers`, `mrr`, `totalAmountPaid`.
// Les chiffres de l'update sont ceux de TOUTE la startup (les agregats prennent
// le maximum entre fondateurs : SPECS §12 q7).
//
// Aucun ARR : il vaut 12 x MRR, une seconde saisie se contredirait. Le revenu
// d'une semaine est la hausse de `totalAmountPaid` d'un update a l'autre.

export type MetricNature = "flow" | "stock";

export type StandardMetric = {
  /** Libelle court (question, courbe, leaderboard). */
  label: string;
  /** Definition affichee sous la question : ce qu'on compte, et ce qu'on ne compte pas. */
  description: string;
  nature: MetricNature;
  unit: "EUR" | null;
};

const flow = (label: string, description: string, unit: "EUR" | null = null): StandardMetric => ({ label, description, nature: "flow", unit });
const stock = (label: string, description: string, unit: "EUR" | null = null): StandardMetric => ({ label, description, nature: "stock", unit });

export const STANDARD_METRICS = {
  // ---- Pipeline (flux, dans l'ordre de l'entonnoir) ----
  messagesSent: flow("Messages sent", "Outreach messages sent: emails, DMs, texts. Not calls."),
  callsMade: flow("Calls made", "Phone or video calls you placed, answered or not."),
  // Decision du 14/11 : 60 s ou plus avec la bonne personne, partout (update du jeudi et hackathons).
  conversationsDone: flow("Conversations done", "Real conversations of 60 seconds or more with the right person (a potential user or customer), discovery interviews included."),
  meetingsBooked: flow("Meetings booked", "Meetings scheduled with a prospect, held or not yet."),
  demosDone: flow("Demos done", "Product demos actually given to a prospect."),
  proposalsSent: flow("Proposals sent", "Proposals, quotes or contracts sent to a prospect."),
  loisSigned: flow("LOIs signed", "Letters of intent or signed commitments, not paid yet."),
  closedWon: flow("Deals won", "Deals won and paid: a new paying customer."),
  amountPaid: flow("Amount paid", "Money actually received, excluding VAT.", "EUR"),
  // ---- Produit (flux) ----
  accountsCreated: flow("Accounts created", "New accounts created on your product. Not waitlist emails."),
  featuresShipped: flow("Features shipped", "Features released to users."),
  // ---- Totaux a date ----
  totalAmountPaid: stock("Total amount paid", "All money received since the company started, excluding VAT.", "EUR"),
  mrr: stock("MRR", "Monthly recurring revenue today: the sum of active subscriptions, per month.", "EUR"),
  payingCustomers: stock("Paying customers", "Customers paying you today."),
  totalUsers: stock("Total users", "All accounts created to date."),
  activeUsers: stock("Active users (last 7 days)", "Users active in the last 7 days."),
} as const satisfies Record<string, StandardMetric>;

export type StandardMetricKey = keyof typeof STANDARD_METRICS;

/**
 * Anciennes cles des metriques d'evenement (`submission.metrics.<cle>`, tous les
 * batchs) -> cle standard. Lu par scripts/migrate-metric-keys.mjs et par
 * l'import SP26 : un reimport ne fait pas revenir une ancienne cle.
 * `emailSubscribers` (liste d'attente) reste a part : ce n'est pas un compte cree.
 */
export const EVENT_METRIC_RENAMES: Readonly<Record<string, StandardMetricKey>> = {
  coldCalls: "callsMade",
  textOutreach: "messagesSent",
  userInterviews: "conversationsDone",
  interviews: "conversationsDone",
  realConversations: "conversationsDone",
  conversations: "conversationsDone",
  bookedMeetings: "meetingsBooked",
  revenue: "amountPaid",
  moneyCollected: "amountPaid",
  lOICount: "loisSigned",
  lois: "loisSigned",
  signedCommitments: "loisSigned",
  users: "accountsCreated",
  signups: "accountsCreated",
  features: "featuresShipped",
};

/**
 * Anciens champs de l'update du jeudi (`checkins`) -> nouveaux. `revenue` et
 * `totalRevenue` (Spring 2026) ne sont PAS renommes : on ne sait pas s'ils
 * etaient encaisses, factures ou recurrents ; ils restent en historique.
 */
export const CHECKIN_FIELD_RENAMES = {
  interviews: "conversationsDone",
  outbound: "messagesSent",
  goalOutreach: "goalMessagesSent",
  goalInterviews: "goalConversationsDone",
  goalNewUsers: "goalAccountsCreated",
  goalRevenue: "goalAmountPaid",
} as const;

// ---- Ce que demande l'update du jeudi : LA liste (registre, modele, type, indicateurs) ----

/** Les chiffres de l'update, dans l'ordre du formulaire. Tous attendus chaque semaine, sauf `CHECKIN_OPTIONAL`. */
export const CHECKIN_METRICS = [
  "messagesSent",
  "callsMade",
  "conversationsDone",
  "meetingsBooked",
  "demosDone",
  "proposalsSent",
  "closedWon",
  "featuresShipped",
  "totalAmountPaid",
  "mrr",
  "payingCustomers",
  "totalUsers",
  "activeUsers",
] as const satisfies readonly StandardMetricKey[];
export type CheckinMetricKey = (typeof CHECKIN_METRICS)[number];
export const CHECKIN_OPTIONAL: ReadonlySet<CheckinMetricKey> = new Set(["messagesSent", "featuresShipped"]);

/** Les objectifs de la semaine suivante : `goal` + la cle du flux vise. */
export const CHECKIN_GOALS = ["goalMessagesSent", "goalConversationsDone", "goalAccountsCreated", "goalAmountPaid"] as const;
export type CheckinGoalKey = (typeof CHECKIN_GOALS)[number];
/** Le flux vise par un objectif (`goalAmountPaid` -> `amountPaid`). */
export const goalTarget = (goal: CheckinGoalKey) => `${goal[4].toLowerCase()}${goal.slice(5)}` as StandardMetricKey;

/** « Calls made (EUR) » : le libelle et son unite, sous la meme forme partout (questions, registre). */
export const withUnit = (label: string, unit: string | null) => (unit ? `${label} (${unit})` : label);

/** La cle standard d'une metrique d'evenement (inchangee si elle l'est deja ou n'a pas d'equivalent). */
export const standardEventMetricKey = (key: string): string => EVENT_METRIC_RENAMES[key] ?? key;

/** La definition d'une cle du dictionnaire, sinon `null` (metrique propre a un exercice). */
export const standardMetricOf = (key: string): StandardMetric | null => (key in STANDARD_METRICS ? STANDARD_METRICS[key as StandardMetricKey] : null);

/** Une metrique d'evenement tiree du dictionnaire (modeles, events.json). */
export const standardEventMetric = (key: StandardMetricKey) => ({ key, label: STANDARD_METRICS[key].label, unit: STANDARD_METRICS[key].unit });
