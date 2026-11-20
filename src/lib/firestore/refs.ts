import {
  collection,
  collectionGroup,
  doc,
  limit,
  query,
  where,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type WhereFilterOp,
} from "firebase/firestore";
import { COL, SUB, docIds, docPaths } from "@shared/collections";
import { readDirectory } from "@shared/types";
import { TEAM_LOCKS_COLLECTION, teamLockPath } from "@shared/teamLocks";
import { FOUNDER_REVIEWS_COLLECTION, STARTUP_REVIEWS_COLLECTION } from "@shared/weeklyReviews";
import type {
  ApiKey,
  AuditLog,
  DeletedEvaluation,
  Attendance,
  Batch,
  BatchResources,
  BatchTask,
  BatchMembership,
  BatchStats,
  CalendarSync,
  Checkin,
  Evaluation,
  JuryLink,
  FounderStats,
  FounderWeek,
  KpiSeries,
  Score,
  ScoreSignals,
  ClaimRequest,
  ClosedList,
  EventTeam,
  Form,
  FormCompletion,
  FormResponse,
  FormVersion,
  Founder,
  FounderConnections,
  FounderDirectory,
  FounderInternal,
  FounderProfile,
  FounderReview,
  Leaderboard,
  ListKey,
  Membership,
  Picks,
  Person,
  PioneersEvent,
  Program,
  Startup,
  StartupInternal,
  StartupProfile,
  StartupReview,
  Submission,
  TaskCompletion,
  TeamLock,
  User,
  WithId,
} from "@shared/types";
import { db } from "@/lib/firebase";

// ----------------------------
// References Firestore typees
// ----------------------------
// SEUL ENDROIT OU S'ECRIVENT LES CHEMINS. Chaque reference porte un
// convertisseur : une lecture rend directement `WithId<T>` (l'id du document
// est ajoute, jamais stocke), sans `as Founder` a chaque appel.

/** `read` : la forme lue d'un document qui a change de forme (`readDirectory`). */
function converter<T>(read: (data: WithId<T>) => WithId<T> = (data) => data): FirestoreDataConverter<WithId<T>, DocumentData> {
  return {
    toFirestore(model) {
      // L'id vit dans le chemin, pas dans le document.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, ...data } = model as Record<string, unknown>;
      return data;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot) {
      return read({ id: snapshot.id, ...snapshot.data() } as WithId<T>);
    },
  };
}

const colRef = <T>(path: string, ...segments: string[]): CollectionReference<WithId<T>> =>
  collection(db, path, ...segments).withConverter(converter<T>());

const docRef = <T>(path: string, ...segments: string[]): DocumentReference<WithId<T>> =>
  doc(db, path, ...segments).withConverter(converter<T>());

/** Un document lu par requete de groupe : on garde l'id de son parent (l'evenement). */
export type WithParent<T> = WithId<T> & { parentId: string };

/** Toutes les sous-collections de ce nom, quel que soit le parent (requetes de groupe). */
const groupRef = <T>(name: string) =>
  collectionGroup(db, name).withConverter<WithParent<T>, DocumentData>({
    toFirestore: () => {
      throw new Error("read only");
    },
    fromFirestore: (snapshot: QueryDocumentSnapshot) =>
      ({ id: snapshot.id, parentId: snapshot.ref.parent.parent?.id ?? "", ...snapshot.data() }) as WithParent<T>,
  });

/** `where` dont le champ est verifie contre le type du document. */
export const whereField = <T>(field: Extract<keyof T, string>, op: WhereFilterOp, value: unknown) =>
  where(field, op, value);

export const refs = {
  users: () => colRef<User>(COL.users),
  apiKeys: () => colRef<ApiKey>(COL.apiKeys),
  /** Journal d'audit : staff en lecture ; un geste de l'Admin y ajoute sa ligne dans son lot (lib/firestore/write.ts). */
  auditLogs: () => colRef<AuditLog>(COL.auditLogs),
  user: (uid: string) => docRef<User>(COL.users, uid),
  people: () => colRef<Person>(COL.people),
  person: (personId: string) => docRef<Person>(docPaths.person(personId)),
  memberships: () => colRef<BatchMembership>(COL.batchMemberships),
  claimRequests: () => colRef<ClaimRequest>(COL.claimRequests),
  claimRequest: (batchId: string, uid: string) =>
    docRef<ClaimRequest>(COL.claimRequests, docIds.claimRequest(batchId, uid)),
  list: (key: ListKey) => docRef<ClosedList>(COL.lists, key),

  programs: () => colRef<Program>(COL.programs),
  program: (programId: string) => docRef<Program>(COL.programs, programId),

  batches: () => colRef<Batch>(COL.batches),
  batch: (batchId: string) => docRef<Batch>(COL.batches, batchId),
  membership: (batchId: string, uid: string) =>
    docRef<BatchMembership>(COL.batchMemberships, docIds.membership(batchId, uid)),

  founders: () => colRef<Founder>(COL.founders),
  founder: (founderId: string) => docRef<Founder>(docPaths.founder(founderId)),
  /** Education toujours en liste, meme sur un document pas encore migre (`readDirectory`). */
  founderDirectory: (founderId: string): DocumentReference<WithId<FounderDirectory>> =>
    doc(db, docPaths.founderDirectory(founderId)).withConverter(converter<FounderDirectory>(readDirectory)),
  founderProfile: (founderId: string) => docRef<FounderProfile>(docPaths.founderProfile(founderId)),
  founderInternal: (founderId: string) => docRef<FounderInternal>(docPaths.founderInternal(founderId)),
  founderConnections: (founderId: string) => docRef<FounderConnections>(docPaths.founderConnections(founderId)),
  /** Lock my team : le fondateur lui-meme et le staff (regle `teamLocks`). */
  teamLocks: () => colRef<TeamLock>(TEAM_LOCKS_COLLECTION),
  teamLock: (founderId: string) => docRef<TeamLock>(teamLockPath(founderId)),
  /** Revue des Weekly updates (lot 4) : staff seul (regles `founderReviews`, `startupReviews`). */
  founderReviews: () => colRef<FounderReview>(FOUNDER_REVIEWS_COLLECTION),
  startupReviews: () => colRef<StartupReview>(STARTUP_REVIEWS_COLLECTION),

  startups: () => colRef<Startup>(COL.startups),
  startup: (startupId: string) => docRef<Startup>(docPaths.startup(startupId)),
  startupProfile: (startupId: string) => docRef<StartupProfile>(docPaths.startupProfile(startupId)),
  startupInternal: (startupId: string) => docRef<StartupInternal>(docPaths.startupInternal(startupId)),

  events: () => colRef<PioneersEvent>(COL.events),
  event: (eventId: string) => docRef<PioneersEvent>(COL.events, eventId),
  batchStats: (batchId: string) => docRef<BatchStats>(COL.batchStats, batchId),
  /** Synchro de l'agenda Google du batch (staff). */
  calendarSync: (batchId: string) => docRef<CalendarSync>(docPaths.calendarSync(batchId)),
  scores: () => colRef<Score>(COL.scores),
  scoreSignals: (targetType: "founder" | "startup", targetId: string) =>
    docRef<ScoreSignals>(COL.scoreSignals, docIds.score(targetType, targetId)),
  founderStats: (founderId: string) => docRef<FounderStats>(COL.founderStats, founderId),
  founderWeeks: () => colRef<FounderWeek>(COL.founderWeeks),
  checkins: () => colRef<Checkin>(COL.checkins),
  kpiSeries: (startupId: string) => docRef<KpiSeries>(COL.kpiSeries, startupId),
  /** Presences de toutes les seances (requete de groupe). */
  allAttendance: () => groupRef<Attendance>(SUB.attendance),
  /** Notes de tous les evenements (requete de groupe). */
  allEvaluations: () => groupRef<Evaluation>(SUB.evaluations),
  /** Appartenances datees aux equipes (`memberships`), a ne pas confondre avec `batchMemberships`. */
  teamMemberships: () => colRef<Membership>(COL.memberships),
  leaderboards: () => colRef<Leaderboard>(COL.leaderboards),
  /** Le classement calcule d'un evenement (`leaderboards/{eventId}`). */
  leaderboard: (eventId: string) => docRef<Leaderboard>(COL.leaderboards, eventId),
  /** Staff et l'auteur (regle `picks`). */
  picks: () => colRef<Picks>(COL.picks),
  forms: () => colRef<Form>(COL.forms),
  form: (formId: string) => docRef<Form>(COL.forms, formId),
  formVersion: (formId: string, version: number) => docRef<FormVersion>(COL.forms, formId, SUB.versions, String(version)),
  eventTeams: (eventId: string) => colRef<EventTeam>(COL.events, eventId, SUB.teams),
  /** Presences d'une seance : staff et investors IC (regle `attendance`). */
  eventAttendance: (eventId: string) => colRef<Attendance>(COL.events, eventId, SUB.attendance),
  attendance: (eventId: string, founderId: string) => docRef<Attendance>(docPaths.attendance(eventId, founderId)),
  /** Reponses brutes : staff seulement (regle `formResponses`). */
  formResponses: () => colRef<FormResponse>(COL.formResponses),
  /** Le fondateur lui-meme et le staff (regle `formCompletions`). */
  formCompletions: () => colRef<FormCompletion>(COL.formCompletions),
  eventTeam: (eventId: string, teamId: string) => docRef<EventTeam>(COL.events, eventId, SUB.teams, teamId),
  /** Resultats des equipes : publics (regle `submissions`), ecrits par le Debrief, le staff ou l'API. */
  eventSubmissions: (eventId: string) => colRef<Submission>(COL.events, eventId, SUB.submissions),
  /** Le lien partage du jury : staff seulement (regle `judges`). */
  juryLink: (eventId: string) => docRef<JuryLink>(docPaths.juryLink(eventId)),
  submission: (eventId: string, teamId: string) => docRef<Submission>(docPaths.submission(eventId, teamId)),
  /** Notes d'un evenement : staff et investors IC (regle `evaluations`). */
  eventEvaluations: (eventId: string) => colRef<Evaluation>(COL.events, eventId, SUB.evaluations),
  /** Notes du jury supprimees, restaurables : staff seulement (regle `deletedEvaluations`). */
  eventDeletedEvaluations: (eventId: string) => colRef<DeletedEvaluation>(COL.events, eventId, SUB.deletedEvaluations),
  teamMembership: (membershipId: string) => docRef<Membership>(COL.memberships, membershipId),
  // ---- Taches du To do ----
  /** Taches du batch : fondateurs du batch, staff, investors (regle `batchTasks`) ; ecrites par le staff. */
  batchTasks: () => colRef<BatchTask>(COL.batchTasks),
  batchTask: (taskId: string) => docRef<BatchTask>(COL.batchTasks, taskId),
  /** Liens utiles du batch : la meme audience (regle `batchResources`) ; ecrits par le staff. */
  batchResources: (batchId: string) => docRef<BatchResources>(docPaths.batchResources(batchId)),
  /** Coches : le fondateur lui-meme et le staff (regle `taskCompletions`). */
  taskCompletions: () => colRef<TaskCompletion>(COL.taskCompletions),
  taskCompletion: (taskId: string, founderId: string) => docRef<TaskCompletion>(docPaths.taskCompletion(taskId, founderId)),
} as const;

/**
 * Requetes nommees. Chacune a une `key` stable qui l'identifie : c'est elle
 * que `useQueryListener` compare pour savoir s'il doit se reabonner.
 */
export const queries = {
  activePrograms: () => ({
    key: "programs:active",
    query: query(refs.programs(), whereField<Program>("archivedDateISOString", "==", null)),
  }),

  batchesOfProgram: (programId: string) => ({
    key: `batches:program=${programId}`,
    query: query(
      refs.batches(),
      whereField<Batch>("programId", "==", programId),
      whereField<Batch>("archivedDateISOString", "==", null),
    ),
  }),

  /** Les fiches du batch : publiques pour tous (regle `founders`, decision du 17/11). */
  foundersOfBatch: (batchId: string) => ({
    key: `founders:batch=${batchId}`,
    query: query(refs.founders(), whereField<Founder>("batchId", "==", batchId)),
  }),

  startupsOfBatch: (batchId: string) => ({
    key: `startups:batch=${batchId}`,
    query: query(
      refs.startups(),
      whereField<Startup>("batchId", "==", batchId),
      whereField<Startup>("archivedDateISOString", "==", null),
    ),
  }),

  eventsOfBatch: (batchId: string) => ({
    key: `events:batch=${batchId}`,
    query: query(refs.events(), whereField<PioneersEvent>("batchId", "==", batchId), limit(200)),
  }),

  /** Batchs ouverts, tous programmes (choix du batch au rattachement). */
  activeBatches: () => ({
    key: "batches:active",
    query: query(refs.batches(), whereField<Batch>("archivedDateISOString", "==", null)),
  }),

  /** Les liens du compte : dans quels batchs il est fondateur. */
  myMemberships: (uid: string) => ({
    key: `batchMemberships:uid=${uid}`,
    query: query(refs.memberships(), whereField<BatchMembership>("uid", "==", uid)),
  }),

  /** Profils non reclames d'un batch (« choisir mon profil »). */
  unclaimedFoundersOfBatch: (batchId: string) => ({
    key: `founders:batch=${batchId}:unclaimed`,
    query: query(
      refs.founders(),
      whereField<Founder>("batchId", "==", batchId),
      whereField<Founder>("uid", "==", null),
    ),
  }),

  myClaimRequests: (uid: string) => ({
    key: `claimRequests:uid=${uid}`,
    query: query(refs.claimRequests(), whereField<ClaimRequest>("uid", "==", uid)),
  }),


  /** Les cles d'API d'un compte (staff : regle `apiKeys`). L'empreinte est lue, jamais la cle. */
  myApiKeys: (uid: string) => ({
    key: `apiKeys:owner=${uid}`,
    query: query(refs.apiKeys(), whereField<ApiKey>("ownerUid", "==", uid)),
  }),

  /** Equipes successives d'un fondateur (hackathons, startup). */
  teamMembershipsOfFounder: (batchId: string, founderId: string) => ({
    key: `memberships:batch=${batchId}:founder=${founderId}`,
    query: query(
      refs.teamMemberships(),
      whereField<Membership>("batchId", "==", batchId),
      whereField<Membership>("founderId", "==", founderId),
    ),
  }),

  /** Leaderboards du batch. La regle lit le reglage du batch : la requete filtre sur `batchId`. */
  leaderboardsOfBatch: (batchId: string) => ({
    key: `leaderboards:batch=${batchId}`,
    query: query(refs.leaderboards(), whereField<Leaderboard>("batchId", "==", batchId)),
  }),

  /** Sous-scores du batch (fondateurs et startups) : staff et investors. */
  scoresOfBatch: (batchId: string) => ({
    key: `scores:batch=${batchId}`,
    query: query(refs.scores(), whereField<Score>("batchId", "==", batchId)),
  }),

  /** Semaines d'un fondateur (formulaires de motivation et d'objectifs). */
  weeksOfFounder: (batchId: string, founderId: string) => ({
    key: `founderWeeks:batch=${batchId}:founder=${founderId}`,
    query: query(
      refs.founderWeeks(),
      whereField<FounderWeek>("batchId", "==", batchId),
      whereField<FounderWeek>("founderId", "==", founderId),
    ),
  }),

  /** Presences d'un fondateur sur toutes les seances (staff et IC, le fondateur les siennes). */
  attendanceOfFounder: (founderId: string) => ({
    key: `attendance:founder=${founderId}`,
    query: query(refs.allAttendance(), whereField<Attendance>("founderId", "==", founderId)),
  }),

  /**
   * Updates du jeudi d'une startup. Un membre n'a droit qu'aux documents dont
   * il fait partie : sa requete le dit (`memberIds` contient son profil).
   */
  checkinsOfStartup: (batchId: string, startupId: string, asMemberFounderId: string | null) => ({
    key: `checkins:startup=${startupId}:as=${asMemberFounderId ?? "team"}`,
    query: asMemberFounderId
      ? query(
          refs.checkins(),
          whereField<Checkin>("batchId", "==", batchId),
          whereField<Checkin>("startupId", "==", startupId),
          whereField<Checkin>("memberIds", "array-contains", asMemberFounderId),
        )
      : query(
          refs.checkins(),
          whereField<Checkin>("batchId", "==", batchId),
          whereField<Checkin>("startupId", "==", startupId),
        ),
  }),

  /** Notes recues par une startup (pitchs), tous evenements (staff et IC). */
  evaluationsOfTarget: (targetId: string) => ({
    key: `evaluations:target=${targetId}`,
    query: query(refs.allEvaluations(), whereField<Evaluation>("targetId", "==", targetId)),
  }),

  /** Tous les formulaires du batch, archives compris (outils staff). */
  formsOfBatch: (batchId: string) => ({
    key: `forms:batch=${batchId}`,
    query: query(refs.forms(), whereField<Form>("batchId", "==", batchId)),
  }),

  /** Historique des equipes du batch (« qui a ete avec qui ») : staff et investors, ou fondateurs du batch. */
  teamMembershipsOfBatch: (batchId: string) => ({
    key: `memberships:batch=${batchId}`,
    query: query(refs.teamMemberships(), whereField<Membership>("batchId", "==", batchId)),
  }),

  /** Notes du jury d'un evenement : staff et investors IC (regle `evaluations`). */
  evaluationsOfEvent: (eventId: string) => ({
    key: `evaluations:event=${eventId}`,
    query: query(refs.eventEvaluations(eventId)),
  }),

  /** Notes du jury supprimees d'un evenement (corbeille) : staff seulement. */
  deletedEvaluationsOfEvent: (eventId: string) => ({
    key: `deletedEvaluations:event=${eventId}`,
    query: query(refs.eventDeletedEvaluations(eventId)),
  }),

  /** Equipes d'un evenement, publiees ou non : staff et investors IC seulement (regle `teams`). */
  teamsOfEvent: (eventId: string) => ({
    key: `teams:event=${eventId}`,
    query: query(refs.eventTeams(eventId)),
  }),

  /** Resultats des equipes d'un evenement (un document par equipe, id = teamId). */
  submissionsOfEvent: (eventId: string) => ({
    key: `submissions:event=${eventId}`,
    query: query(refs.eventSubmissions(eventId)),
  }),

  /** Equipes publiees d'un evenement : la regle `teams` exige ce filtre d'un visiteur sans role. */
  publishedTeamsOfEvent: (eventId: string) => ({
    key: `teams:event=${eventId}:published`,
    query: query(refs.eventTeams(eventId), whereField<EventTeam>("publishedDateISOString", "!=", null)),
  }),

  /** Les formulaires auxquels j'ai repondu dans ce batch : la regle `formCompletions` exige ces deux filtres. */
  myFormCompletions: (batchId: string, founderId: string) => ({
    key: `formCompletions:batch=${batchId}:founder=${founderId}`,
    query: query(
      refs.formCompletions(),
      whereField<FormCompletion>("batchId", "==", batchId),
      whereField<FormCompletion>("founderId", "==", founderId),
    ),
  }),

  /** Les formulaires d'un evenement (lisibles de tous : la page de l'evenement, son administration). */
  formsOfEvent: (eventId: string) => ({
    key: `forms:event=${eventId}`,
    query: query(refs.forms(), whereField<Form>("eventId", "==", eventId)),
  }),

  /** Tous les choix d'un evenement (staff). */
  picksOfEvent: (eventId: string) => ({
    key: `picks:event=${eventId}`,
    query: query(refs.picks(), whereField<Picks>("eventId", "==", eventId)),
  }),

  /** Reponses d'un formulaire (staff). */
  responsesOfForm: (formId: string) => ({
    key: `formResponses:form=${formId}`,
    query: query(refs.formResponses(), whereField<FormResponse>("formId", "==", formId)),
  }),

  /** Presences d'une seance (staff) : qui etait la, pour les relances d'un feedback. */
  attendanceOfEvent: (eventId: string) => ({
    key: `attendance:event=${eventId}`,
    query: query(refs.eventAttendance(eventId)),
  }),

  openFormsOfBatch: (batchId: string) => ({
    key: `forms:batch=${batchId}:open`,
    query: query(
      refs.forms(),
      whereField<Form>("batchId", "==", batchId),
      whereField<Form>("status", "==", "open"),
    ),
  }),

  // ---- Taches du To do ----
  /** Les taches non archivees du batch (fondateur et staff) : la regle exige le filtre `batchId`. */
  tasksOfBatch: (batchId: string) => ({
    key: `batchTasks:batch=${batchId}:active`,
    query: query(
      refs.batchTasks(),
      whereField<BatchTask>("batchId", "==", batchId),
      whereField<BatchTask>("archivedDateISOString", "==", null),
    ),
  }),

  /** Mes coches dans ce batch : la regle `taskCompletions` exige ces deux filtres. */
  myTaskCompletions: (batchId: string, founderId: string) => ({
    key: `taskCompletions:batch=${batchId}:founder=${founderId}`,
    query: query(
      refs.taskCompletions(),
      whereField<TaskCompletion>("batchId", "==", batchId),
      whereField<TaskCompletion>("founderId", "==", founderId),
    ),
  }),

  /** Toutes les coches du batch (staff : suivi des retardataires). */
  taskCompletionsOfBatch: (batchId: string) => ({
    key: `taskCompletions:batch=${batchId}`,
    query: query(refs.taskCompletions(), whereField<TaskCompletion>("batchId", "==", batchId)),
  }),

  /** Les reponses a Lock my team du batch (staff et investors IC : Admin > Startups). */
  teamLocksOfBatch: (batchId: string) => ({
    key: `teamLocks:batch=${batchId}`,
    query: query(refs.teamLocks(), whereField<TeamLock>("batchId", "==", batchId)),
  }),

  // ---- Admin > Reviews (lot 4) : les Weekly updates du batch et leurs revues (staff) ----
  founderWeeksOfBatch: (batchId: string) => ({
    key: `founderWeeks:batch=${batchId}`,
    query: query(refs.founderWeeks(), whereField<FounderWeek>("batchId", "==", batchId)),
  }),
  checkinsOfBatch: (batchId: string) => ({
    key: `checkins:batch=${batchId}`,
    query: query(refs.checkins(), whereField<Checkin>("batchId", "==", batchId)),
  }),
  founderReviewsOfBatch: (batchId: string) => ({
    key: `founderReviews:batch=${batchId}`,
    query: query(refs.founderReviews(), whereField<FounderReview>("batchId", "==", batchId)),
  }),
  startupReviewsOfBatch: (batchId: string) => ({
    key: `startupReviews:batch=${batchId}`,
    query: query(refs.startupReviews(), whereField<StartupReview>("batchId", "==", batchId)),
  }),
} as const;
