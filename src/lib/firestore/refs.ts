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
import type {
  Attendance,
  Batch,
  BatchMembership,
  BatchStats,
  Checkin,
  Evaluation,
  FounderStats,
  FounderWeek,
  KpiSeries,
  Score,
  ScoreSignals,
  ClaimRequest,
  ClosedList,
  EventTeam,
  Form,
  FormVersion,
  Founder,
  FounderDirectory,
  FounderInternal,
  FounderProfile,
  Leaderboard,
  ListKey,
  Membership,
  Person,
  PioneersEvent,
  Program,
  Startup,
  StartupInternal,
  StartupProfile,
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

function converter<T>(): FirestoreDataConverter<WithId<T>, DocumentData> {
  return {
    toFirestore(model) {
      // L'id vit dans le chemin, pas dans le document.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, ...data } = model as Record<string, unknown>;
      return data;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot) {
      return { id: snapshot.id, ...snapshot.data() } as WithId<T>;
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
  founderDirectory: (founderId: string) => docRef<FounderDirectory>(docPaths.founderDirectory(founderId)),
  founderProfile: (founderId: string) => docRef<FounderProfile>(docPaths.founderProfile(founderId)),
  founderInternal: (founderId: string) => docRef<FounderInternal>(docPaths.founderInternal(founderId)),

  startups: () => colRef<Startup>(COL.startups),
  startup: (startupId: string) => docRef<Startup>(docPaths.startup(startupId)),
  startupProfile: (startupId: string) => docRef<StartupProfile>(docPaths.startupProfile(startupId)),
  startupInternal: (startupId: string) => docRef<StartupInternal>(docPaths.startupInternal(startupId)),

  events: () => colRef<PioneersEvent>(COL.events),
  event: (eventId: string) => docRef<PioneersEvent>(COL.events, eventId),
  batchStats: (batchId: string) => docRef<BatchStats>(COL.batchStats, batchId),
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
  forms: () => colRef<Form>(COL.forms),
  form: (formId: string) => docRef<Form>(COL.forms, formId),
  formVersion: (formId: string, version: number) => docRef<FormVersion>(COL.forms, formId, SUB.versions, String(version)),
  eventTeams: (eventId: string) => colRef<EventTeam>(COL.events, eventId, SUB.teams),
  eventTeam: (eventId: string, teamId: string) => docRef<EventTeam>(COL.events, eventId, SUB.teams, teamId),
  teamMembership: (membershipId: string) => docRef<Membership>(COL.memberships, membershipId),
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

  /**
   * Un visiteur public ne peut lister QUE les profils consentants : la regle
   * Firestore refuse une requete qui pourrait renvoyer un autre document, il
   * faut donc que la requete elle-meme porte le filtre.
   */
  foundersOfBatch: (batchId: string, scope: "public" | "batch") => ({
    key: `founders:batch=${batchId}:${scope}`,
    query:
      scope === "public"
        ? query(
            refs.founders(),
            whereField<Founder>("batchId", "==", batchId),
            whereField<Founder>("publicProfileConsent", "==", true),
          )
        : query(refs.founders(), whereField<Founder>("batchId", "==", batchId)),
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

  /** Profils non reclames d'un batch (« choisir mon profil »). La regle exige le filtre `uid == null`. */
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

  claimRequestsOfBatch: (batchId: string) => ({
    key: `claimRequests:batch=${batchId}`,
    query: query(refs.claimRequests(), whereField<ClaimRequest>("batchId", "==", batchId)),
  }),

  /** Tous les comptes (staff). */
  allUsers: () => ({ key: "users:all", query: query(refs.users(), limit(1000)) }),

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

  /** Presences d'un fondateur sur toutes les seances (staff et IC). */
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

  /** Equipes d'un evenement, publiees ou non : staff et investors IC seulement (regle `teams`). */
  teamsOfEvent: (eventId: string) => ({
    key: `teams:event=${eventId}`,
    query: query(refs.eventTeams(eventId)),
  }),

  /** Equipes publiees d'un evenement : la regle `teams` exige ce filtre d'un visiteur sans role. */
  publishedTeamsOfEvent: (eventId: string) => ({
    key: `teams:event=${eventId}:published`,
    query: query(refs.eventTeams(eventId), whereField<EventTeam>("publishedDateISOString", "!=", null)),
  }),

  openFormsOfBatch: (batchId: string) => ({
    key: `forms:batch=${batchId}:open`,
    query: query(
      refs.forms(),
      whereField<Form>("batchId", "==", batchId),
      whereField<Form>("status", "==", "open"),
    ),
  }),
} as const;
