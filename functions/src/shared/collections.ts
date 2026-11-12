import type { TargetKind } from "./types";

// ----------------------------
// Noms des collections et ids deterministes
// ----------------------------
// Les collections sont A PLAT (comme chez Trippple) : chaque document porte
// l'id de ses parents (`programId`, `batchId`). On peut ainsi interroger tous
// les fondateurs d'un programme, ou comparer des batchs, sans requete de
// groupe. Les sous-collections ne servent qu'a deux choses : separer les
// niveaux de visibilite d'une meme entite (`private/*`), et ranger ce qui
// n'existe qu'a l'interieur d'un evenement (equipes, notes du jury...).
// Modele complet : SPECS.md §6.1, qui voit quoi : §6.2.

export const COL = {
  // Personnes et acces
  people: "people",
  users: "users",
  batchMemberships: "batchMemberships",
  claimRequests: "claimRequests",
  apiKeys: "apiKeys",
  // Programme
  programs: "programs",
  batches: "batches",
  batchStats: "batchStats",
  // Fondateurs et startups
  founders: "founders",
  founderWeeks: "founderWeeks",
  founderStats: "founderStats",
  picks: "picks",
  startups: "startups",
  checkins: "checkins",
  metricSnapshots: "metricSnapshots",
  memberships: "memberships",
  kpiSeries: "kpiSeries",
  // Evenements et formulaires
  events: "events",
  leaderboards: "leaderboards",
  sessionRatings: "sessionRatings",
  eventStats: "eventStats",
  forms: "forms",
  formResponses: "formResponses",
  fieldSuggestions: "fieldSuggestions",
  completeness: "completeness",
  // Evaluation interne
  scores: "scores",
  scoreSignals: "scoreSignals",
  eloMatches: "eloMatches",
  notes: "notes",
  assessments: "assessments",
  // Mentors et investors (les fonctions sont en bonus, la base est prete)
  mentors: "mentors",
  mentorPicks: "mentorPicks",
  startupMentorPicks: "startupMentorPicks",
  mentorships: "mentorships",
  mentorFeedback: "mentorFeedback",
  investors: "investors",
  investments: "investments",
  portfolioReports: "portfolioReports",
  // Systeme
  lists: "lists",
  auditLogs: "auditLogs",
  /** Apercus d'ecriture du MCP, en attente de confirmation (serveur seulement). */
  writePlans: "writePlans",
  /** Reponses rejouables de /v1 (`Idempotency-Key`, serveur seulement). */
  idempotencyKeys: "idempotencyKeys",
  /** Connecteur Claude (OAuth 2.1, serveur seulement) : clients, demandes, codes, autorisations, jetons. */
  oauthClients: "oauthClients",
  oauthRequests: "oauthRequests",
  oauthCodes: "oauthCodes",
  oauthGrants: "oauthGrants",
  oauthTokens: "oauthTokens",
} as const;

export const SUB = {
  /** founders/{id}/private/{directory|profile|internal}, startups/{id}/private/{profile|internal} */
  private: "private",
  teams: "teams",
  submissions: "submissions",
  evaluations: "evaluations",
  judges: "judges",
  attendance: "attendance",
  peerRatings: "peerRatings",
  versions: "versions",
} as const;

/** Ids des documents de `private/` : chacun a sa regle de lecture. */
export const PRIVATE_DOC = {
  /** Fondateur : champs du Profile Book. Fondateurs du batch + staff + investors. */
  directory: "directory",
  /**
   * Fondateur : age et date de naissance. Le fondateur lui-meme + staff + investors IC.
   * Startup : profil et analyse de marche. Membres + staff + investors.
   */
  profile: "profile",
  /** Donnees internes. Staff + investors IC. */
  internal: "internal",
} as const;

/**
 * Ids deterministes : une ecriture rejouee retombe sur le meme document au lieu
 * d'en creer un second (import rejoue, double clic, relance d'une fonction,
 * requete d'API rejouee).
 */
export const docIds = {
  membership: (batchId: string, uid: string) => `${batchId}_${uid}`,
  claimRequest: (batchId: string, uid: string) => `${batchId}_${uid}`,
  evaluation: (evaluatorId: string, targetId: string) => `${evaluatorId}_${targetId}`,
  peerRating: (raterFounderId: string, rateeFounderId: string) => `${raterFounderId}_${rateeFounderId}`,
  picks: (eventId: string, founderId: string) => `${eventId}_${founderId}`,
  founderWeek: (founderId: string, weekStartDayString: string) => `${founderId}_${weekStartDayString}`,
  /** Un update par fondateur et par semaine : plusieurs membres peuvent chacun remplir le leur. */
  checkin: (startupId: string, weekStartDayString: string, founderId: string) =>
    `${startupId}_${weekStartDayString}_${founderId}`,
  completeness: (owner: TargetKind, targetId: string) => `${owner}_${targetId}`,
  sessionRating: (eventId: string, founderId: string) => `${eventId}_${founderId}`,
  /** Une appartenance par fondateur, equipe et date de debut. */
  teamMembership: (teamId: string, founderId: string, startDayString: string) => `${teamId}_${founderId}_${startDayString}`,
  /** Un releve par sujet, metrique, jour et phase : un import rejoue retombe sur le meme document. */
  metricSnapshot: (subjectId: string, metric: string, dayString: string, phase: "before" | "after" | null) =>
    `${subjectId}_${metric}_${dayString}${phase ? `_${phase}` : ""}`,
  /** Une fiche par cible et par etape de decision (`current` hors etape). */
  assessment: (targetType: TargetKind, targetId: string, stage: string | null) =>
    `${targetType}_${targetId}_${stage ?? "current"}`,
  /** Meme id pour `scores` et `scoreSignals`. */
  score: (targetType: TargetKind, targetId: string) => `${targetType}_${targetId}`,
  mentorPicks: (batchId: string, mentorId: string) => `${batchId}_${mentorId}`,
  mentorship: (startupId: string, mentorId: string) => `${startupId}_${mentorId}`,
  mentorFeedback: (eventId: string, founderId: string) => `${eventId}_${founderId}`,
  portfolioReport: (startupId: string, monthString: string) => `${startupId}_${monthString}`,
} as const;

/**
 * Chemins des documents a cle composee ou prives. SEUL endroit ou ces chemins
 * s'ecrivent : `refs.ts` (front) et le registre des champs (API, MCP, import)
 * s'en servent tous les deux.
 */
export const docPaths = {
  batch: (batchId: string) => `${COL.batches}/${batchId}`,
  /** Rattachement d'un compte a un profil fondateur du batch. */
  membership: (batchId: string, uid: string) => `${COL.batchMemberships}/${docIds.membership(batchId, uid)}`,
  list: (listKey: string) => `${COL.lists}/${listKey}`,
  form: (formId: string) => `${COL.forms}/${formId}`,
  mentor: (mentorId: string) => `${COL.mentors}/${mentorId}`,
  person: (personId: string) => `${COL.people}/${personId}`,
  founder: (founderId: string) => `${COL.founders}/${founderId}`,
  founderDirectory: (founderId: string) => `${COL.founders}/${founderId}/${SUB.private}/${PRIVATE_DOC.directory}`,
  founderProfile: (founderId: string) => `${COL.founders}/${founderId}/${SUB.private}/${PRIVATE_DOC.profile}`,
  founderInternal: (founderId: string) => `${COL.founders}/${founderId}/${SUB.private}/${PRIVATE_DOC.internal}`,
  founderWeek: (founderId: string, weekStartDayString: string) =>
    `${COL.founderWeeks}/${docIds.founderWeek(founderId, weekStartDayString)}`,
  startup: (startupId: string) => `${COL.startups}/${startupId}`,
  startupProfile: (startupId: string) => `${COL.startups}/${startupId}/${SUB.private}/${PRIVATE_DOC.profile}`,
  startupInternal: (startupId: string) => `${COL.startups}/${startupId}/${SUB.private}/${PRIVATE_DOC.internal}`,
  checkin: (startupId: string, weekStartDayString: string, founderId: string) =>
    `${COL.checkins}/${docIds.checkin(startupId, weekStartDayString, founderId)}`,
  attendance: (eventId: string, founderId: string) => `${COL.events}/${eventId}/${SUB.attendance}/${founderId}`,
  submission: (eventId: string, teamId: string) => `${COL.events}/${eventId}/${SUB.submissions}/${teamId}`,
  event: (eventId: string) => `${COL.events}/${eventId}`,
  team: (eventId: string, teamId: string) => `${COL.events}/${eventId}/${SUB.teams}/${teamId}`,
  evaluation: (eventId: string, evaluatorId: string, targetId: string) =>
    `${COL.events}/${eventId}/${SUB.evaluations}/${docIds.evaluation(evaluatorId, targetId)}`,
  leaderboard: (eventId: string) => `${COL.leaderboards}/${eventId}`,
  picks: (eventId: string, founderId: string) => `${COL.picks}/${docIds.picks(eventId, founderId)}`,
  sessionRating: (eventId: string, founderId: string) => `${COL.sessionRatings}/${docIds.sessionRating(eventId, founderId)}`,
  /** Jure sans compte (empreinte du secret de son lien) : staff seulement, jamais lu par l'API (SPECS §4.8). */
  judge: (eventId: string, judgeId: string) => `${COL.events}/${eventId}/${SUB.judges}/${judgeId}`,
  judges: (eventId: string) => `${COL.events}/${eventId}/${SUB.judges}`,
  /** Ecrit par la callable du Debrief ; jamais lu par l'API (SPECS §4.8). */
  peerRating: (eventId: string, raterFounderId: string, rateeFounderId: string) =>
    `${COL.events}/${eventId}/${SUB.peerRatings}/${docIds.peerRating(raterFounderId, rateeFounderId)}`,
  metricSnapshot: (subjectId: string, metric: string, dayString: string, phase: "before" | "after" | null) =>
    `${COL.metricSnapshots}/${docIds.metricSnapshot(subjectId, metric, dayString, phase)}`,
} as const;

/** Sous-collections d'un evenement lues par le serveur (jamais `peerRatings` ni `judges` : SPECS §4.8). */
export const eventCollectionPaths = {
  teams: (eventId: string) => `${COL.events}/${eventId}/${SUB.teams}`,
  attendance: (eventId: string) => `${COL.events}/${eventId}/${SUB.attendance}`,
  submissions: (eventId: string) => `${COL.events}/${eventId}/${SUB.submissions}`,
  evaluations: (eventId: string) => `${COL.events}/${eventId}/${SUB.evaluations}`,
} as const;

