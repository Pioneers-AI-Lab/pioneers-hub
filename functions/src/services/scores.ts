import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type DocumentData, type Query } from "firebase-admin/firestore";
import { COL, docIds, docPaths, eventCollectionPaths, SUB } from "../shared/collections";
import { absentFounderIds, isAttendanceOptional, mandatoryAttendance } from "../shared/attendance";
import { computeBatchStats } from "../shared/batchStats";
import { isWorkTeamEvent } from "../shared/events";
import { countRequiredFields, listMissingFields } from "../shared/fieldRegistry";
import { formAudience } from "../shared/formRules";
import { juryCriteria } from "../shared/forms";
import { ratedBackgroundScore } from "../shared/background";
import { isPitchRubric, pitchGrid, pitchJuryMeans, pitchMeans, type PitchInput } from "../shared/pitchGrid";
import {
  computeFounderScore,
  computeStartupScore,
  countsInFormsOnTime,
  founderMilestones,
  hackathonsByFounder,
  reciprocalMetCount,
  supportersOf,
  type FounderScoreInputs,
} from "../shared/scoring";
import { countsInExecution } from "../shared/scoringRules";
import { SHORTLIST_HISTORY_COLLECTION } from "../shared/shortlistHistory";
import { FOUNDER_REVIEWS_COLLECTION, problemValidatedOf, STARTUP_REVIEWS_COLLECTION, weeklyGoalScore, weeklyTractionOf } from "../shared/weeklyReviews";
import {
  HUB_SCORE_SCALE,
  isBatchParticipant,
  mean,
  readConnections,
  type Attendance,
  type Batch,
  type Evaluation,
  type Form,
  type FormCompletion,
  type Founder,
  type FounderConnections,
  type FounderDirectory,
  type FounderInternal,
  type FounderReview,
  type FounderScore,
  type FounderStats,
  type FounderWeek,
  type Leaderboard,
  type Membership,
  type PeerRating,
  type Picks,
  type PioneersEvent,
  type ScoreSignals,
  type ShortlistRecord,
  type Startup,
  type StartupReview,
  type StartupScore,
} from "../shared/types";

// ----------------------------
// services - les scores d'un batch (SPECS §5, §5.5)
// ----------------------------
// Le SEUL ecrivain de `scores`, `scoreSignals`, `founderStats` et `batchStats` pour un batch
// dont les scores viennent du Hub (`settings.scoresSource !== "imported"`) :
// Spring 2026, recopie de l'ancien dashboard, n'est jamais touche.
// Tout le batch d'un coup : Likability se rapporte au meilleur du batch, Met a sa
// taille. Trois declencheurs : chaque nuit (`nightlyScores`), a la publication d'un
// classement (`publishEventRanking`), et le bouton du staff (`recomputeBatchScores`).
// Formules (sur 100, docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §3) : shared/scoring.ts ;
// ici, les entrees. Les scores ecrits portent `scale: 100`.

const db = () => getFirestore();
const docs = async <T>(query: Query<DocumentData>): Promise<(T & { id: string })[]> =>
  (await query.get()).docs.map((d) => ({ ...(d.data() as T), id: d.id }));

/** Un document par id, `null` s'il manque. */
async function byIds<T>(paths: readonly string[]): Promise<(T | null)[]> {
  if (paths.length === 0) return [];
  const snaps = await db().getAll(...paths.map((p) => db().doc(p)));
  return snaps.map((s) => (s.exists ? (s.data() as T) : null));
}

const countMap = () => new Map<string, Set<string>>();
const addTo = (map: Map<string, Set<string>>, key: string, value: string) => {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
};
const pushTo = <V>(map: Map<string, V[]>, key: string, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export type BatchScoresResult = { batchId: string; founders: number; startups: number; computedDateISOString: string };

export async function recomputeBatchScores(batchId: string): Promise<BatchScoresResult> {
  const batchSnap = await db().doc(docPaths.batch(batchId)).get();
  if (!batchSnap.exists) throw new HttpsError("not-found", `Batch \`${batchId}\` not found.`);
  const batch = batchSnap.data() as Batch;
  if (batch.settings.scoresSource === "imported") {
    throw new HttpsError("failed-precondition", "This batch's scores were imported from a former tool: they are not recomputed.");
  }
  const now = new Date().toISOString();

  const [allFounders, events, forms, completions, weeks, memberships, boards, startups, picks, history, founderReviews, startupReviews] = await Promise.all([
    docs<Founder>(db().collection(COL.founders).where("batchId", "==", batchId)),
    docs<PioneersEvent>(db().collection(COL.events).where("batchId", "==", batchId)),
    docs<Form>(db().collection(COL.forms).where("batchId", "==", batchId)),
    docs<FormCompletion>(db().collection(COL.formCompletions).where("batchId", "==", batchId)),
    docs<FounderWeek>(db().collection(COL.founderWeeks).where("batchId", "==", batchId)),
    docs<Membership>(db().collection(COL.memberships).where("batchId", "==", batchId)),
    docs<Leaderboard>(db().collection(COL.leaderboards).where("batchId", "==", batchId)),
    docs<Startup>(db().collection(COL.startups).where("batchId", "==", batchId)),
    docs<Picks>(db().collection(COL.picks).where("batchId", "==", batchId)),
    docs<ShortlistRecord>(db().collection(SHORTLIST_HISTORY_COLLECTION).where("batchId", "==", batchId)),
    // La file de revue des Weekly updates (shared/weeklyReviews.ts) : milestones et Traction.
    docs<FounderReview>(db().collection(FOUNDER_REVIEWS_COLLECTION).where("batchId", "==", batchId)),
    docs<StartupReview>(db().collection(STARTUP_REVIEWS_COLLECTION).where("batchId", "==", batchId)),
  ]);
  const founders = allFounders.filter((f) => isBatchParticipant(f, batchId));
  const founderIds = new Set(founders.map((f) => f.id));
  // Les evenements qui comptent : publies, non archives, deja commences.
  const pastEvents = events.filter((e) => e.archivedDateISOString === null && e.status !== "draft" && e.startDateISOString <= now);
  const eventById = new Map(events.map((e) => [e.id, e]));
  // La presence lue : evenements obligatoires (Engagement, formulaires) et ceux d'un classement qui compte (absents de l'Execution).
  // Un classement compte dans l'Execution des fondateurs s'il classe des equipes de travail : pas un pitch (il classe des startups).
  const executionBoards = boards.filter((b) => {
    const event = eventById.get(b.eventId);
    return countsInExecution(b) && event !== undefined && isWorkTeamEvent(event);
  });
  // Les pitchs (lot 5) : les evenements passes, dans l'ordre, dont le jury a la grille Pitch (shared/pitchGrid.ts).
  const formsOfEvent = new Map<string, Form[]>();
  for (const f of forms) if (f.eventId) pushTo(formsOfEvent, f.eventId, f);
  const pitchEvents = pastEvents
    .filter((e) => isPitchRubric(juryCriteria(formsOfEvent.get(e.id) ?? [])))
    .sort((a, b) => a.startDateISOString.localeCompare(b.startDateISOString));
  const boardEventIds = new Set(executionBoards.map((b) => b.eventId));
  const attendanceEvents = pastEvents.filter((e) => !isAttendanceOptional(e) || boardEventIds.has(e.id));

  const [attendanceByEvent, peerRatings, directories, internals, connections, pitchReads] = await Promise.all([
    Promise.all(attendanceEvents.map(async (e) => [e.id, await docs<Attendance>(db().collection(eventCollectionPaths.attendance(e.id)))] as const)).then(
      (entries) => new Map(entries),
    ),
    // Les avis entre pairs : agreges ici, jamais lus ailleurs par le serveur (SPECS §4.8).
    Promise.all(
      pastEvents.filter(isWorkTeamEvent).map((e) => docs<PeerRating>(db().collection(`${COL.events}/${e.id}/${SUB.peerRatings}`))),
    ).then((lists) => lists.flat()),
    byIds<FounderDirectory>(founders.map((f) => docPaths.founderDirectory(f.id))),
    byIds<FounderInternal>(founders.map((f) => docPaths.founderInternal(f.id))),
    // Shortlist et « Met » : lus ici pour Likability et les milestones, jamais affiches aux autres.
    byIds<FounderConnections>(founders.map((f) => docPaths.founderConnections(f.id))),
    // Les notes du jury de chaque pitch.
    Promise.all(pitchEvents.map(async (event) => ({ event, evaluations: await docs<Evaluation>(db().collection(eventCollectionPaths.evaluations(event.id))) }))),
  ]);
  const directoryOf = new Map(founders.map((f, i) => [f.id, directories[i]]));
  const internalOf = new Map(founders.map((f, i) => [f.id, internals[i]]));
  const connectionsOf = new Map(founders.map((f, i) => [f.id, readConnections(connections[i])]));

  // ---- Presence : les evenements OBLIGATOIRES ou il etait attendu ; sans aucun marquage, tous presents.
  const attendance = mandatoryAttendance(batchId, pastEvents, founders, attendanceByEvent);

  // ---- Formulaires a temps : echeance passee, non anonymes, ni jury, ni d'un evenement optionnel ;
  // repondu avant l'echeance. Un absent n'est pas destinataire (`formAudience`).
  // Les membres des equipes publiees, par evenement ; et les equipes de travail (challenge), par evenement et equipe.
  const teamMembersOf = new Map<string, string[]>();
  const workTeams = new Map<string, string[]>();
  for (const m of memberships) {
    if (m.kind !== "event_team" || !m.eventId) continue;
    pushTo(teamMembersOf, m.eventId, m.founderId);
    const event = eventById.get(m.eventId);
    if (event && isWorkTeamEvent(event)) pushTo(workTeams, `${m.eventId}/${m.teamId}`, m.founderId);
  }
  // La premiere reponse compte pour « a temps » ; la derniere n'est que l'information.
  const completedAt = new Map(completions.map((c) => [docIds.formCompletion(c.formId, c.founderId), c.firstCompletedDateISOString ?? c.completedDateISOString]));
  const formsOnTime = new Map(founders.map((f) => [f.id, { onTime: 0, expected: 0 }]));
  for (const form of forms) {
    const event = form.eventId ? (eventById.get(form.eventId) ?? null) : null;
    if (!countsInFormsOnTime(form, event, now)) continue;
    const deadline = form.deadlineDateISOString!;
    const audience = formAudience({
      form,
      batchId,
      founders,
      event,
      attendance: event ? (attendanceByEvent.get(event.id) ?? []) : [],
      teamMemberIds: event ? (teamMembersOf.get(event.id) ?? []) : [],
    });
    if (audience.kind !== "founders") continue;
    for (const id of audience.founderIds) {
      const stat = formsOnTime.get(id);
      if (!stat) continue;
      stat.expected += 1;
      const at = completedAt.get(docIds.formCompletion(form.id, id));
      if (at && at <= deadline) stat.onTime += 1;
    }
  }

  // ---- Execution : la note sur 100 de son equipe a chaque hackathon publie ou il etait present
  // (un absent n'est ni classe ni compte), avec le poids de l'evenement, dans l'ordre des hackathons.
  const hackathons = hackathonsByFounder(
    executionBoards
      .flatMap((board) => {
        const event = eventById.get(board.eventId);
        return event && event.archivedDateISOString === null
          ? [{ rows: board.rows, event, absentIds: absentFounderIds(attendanceByEvent.get(event.id) ?? []) }]
          : [];
      })
      .sort((a, b) => a.event.startDateISOString.localeCompare(b.event.startDateISOString)),
  );

  // ---- Shortlists : l'historique (ajout seul) et les listes actuelles (avant le rattrapage).
  // Qui il a shortliste un jour, parmi les autres fondateurs du batch (filtre une fois, ici).
  const shortlisted = countMap();
  const addShortlisted = (founderId: string, target: string) => {
    if (founderId !== target && founderIds.has(founderId) && founderIds.has(target)) addTo(shortlisted, founderId, target);
  };
  for (const r of history) addShortlisted(r.founderId, r.targetFounderId);
  for (const [id, lists] of connectionsOf) for (const target of lists.shortlistedFounderIds) addShortlisted(id, target);

  // ---- Reseau (founderStats, affichage) : picks, interet et « je travaille avec », coequipiers, peer ratings.
  const interestIn = countMap(); // qui l'a choisi
  const interestOut = countMap();
  const workingIn = countMap();
  const workingOut = countMap();
  for (const p of picks) {
    for (const target of p.pickedFounderIds) {
      if (target === p.founderId) continue;
      addTo(interestIn, target, p.founderId);
      addTo(interestOut, p.founderId, target);
    }
  }
  for (const w of weeks) {
    for (const target of w.interestedInFounderIds ?? []) {
      addTo(interestIn, target, w.founderId);
      addTo(interestOut, w.founderId, target);
    }
    for (const target of w.workingWithFounderIds ?? []) {
      addTo(workingIn, target, w.founderId);
      addTo(workingOut, w.founderId, target);
    }
  }
  const teammates = countMap();
  for (const members of workTeams.values()) for (const a of members) for (const b of members) if (a !== b) addTo(teammates, a, b);
  const peer = new Map<string, number[]>();
  for (const r of peerRatings) pushTo(peer, r.rateeFounderId, r.rating);
  // Likability : qui l'a shortliste un jour, ou lui a donne 4 ou 5 (une personne compte une fois).
  const supporters = supportersOf(founderIds, shortlisted, peerRatings);

  const batchMaxSupporters = Math.max(0, ...founders.map((f) => supporters.get(f.id)?.size ?? 0));
  const requiredFields = countRequiredFields("founder");
  // Fondateurs du batch dans chaque startup (Teamed up).
  const startupFounderCount = new Map(startups.map((s) => [s.id, s.memberIds.filter((id) => founderIds.has(id)).length]));
  const metOf = new Map([...connectionsOf].map(([id, lists]) => [id, new Set(lists.metFounderIds)]));
  const reviewsOfFounder = new Map<string, FounderReview[]>();
  for (const r of founderReviews) pushTo(reviewsOfFounder, r.founderId, r);
  const reviewsOfStartup = new Map<string, StartupReview[]>();
  for (const r of startupReviews) pushTo(reviewsOfStartup, r.startupId, r);
  // ---- Pitchs : chaque startup notee, a chaque pitch, sur la moyenne de ses jures critere par critere
  // (puis le score prend la moyenne de ses pitchs : `pitchMeans`), dans l'ordre des pitchs. L'Outstanding
  // mention du staff : celle du classement de l'evenement (posee sur la Submission, comptee a 100).
  const boardOf = new Map(boards.map((b) => [b.eventId, b]));
  const pitchesOf = new Map<string, PitchInput[]>();
  for (const { event, evaluations } of pitchReads) {
    const outstandingIds = new Set(boardOf.get(event.id)?.rows.flatMap((r) => (r.outstanding ? [r.targetId] : [])) ?? []);
    const byStartup = new Map<string, Evaluation[]>();
    for (const e of evaluations) if (e.targetType === "startup") pushTo(byStartup, e.targetId, e);
    for (const [startupId, evals] of byStartup) pushTo(pitchesOf, startupId, { name: event.name, grid: pitchGrid(pitchJuryMeans(evals), outstandingIds.has(startupId)) });
  }
  const clearIdeaOf = new Map([...pitchesOf].map(([startupId, pitches]) => [startupId, pitchMeans(pitches).clearIdea]));

  const write = db().bulkWriter();
  const scoped = { programId: batch.programId, batchId };
  write.set(
    db().doc(`${COL.batchStats}/${batchId}`),
    computeBatchStats(batch.programId, founders.map((f) => ({ founder: f, directory: directoryOf.get(f.id) ?? null })), now),
  );
  const executionOf = new Map<string, number | null>();

  for (const f of founders) {
    const directory = directoryOf.get(f.id) ?? null;
    const missingRequired = listMissingFields({
      owner: "founder",
      docs: {
        founder: f,
        founderDirectory: directory,
        person: { whatsapp: directory?.whatsapp ?? null, linkedinUrl: directory?.linkedinUrl ?? null },
      },
      weeks: [],
      events: [],
    }).filter((m) => m.priority === "required" && m.weekStartDayString === null && m.eventId === null).length;
    const ratings = peer.get(f.id) ?? [];
    const reviews = reviewsOfFounder.get(f.id) ?? [];
    const inputs: FounderScoreInputs = {
      nowISOString: now,
      attendance: attendance.get(f.id)!,
      formsOnTime: formsOnTime.get(f.id)!,
      profileCompleteness: requiredFields > 0 ? Math.max(0, (requiredFields - missingRequired) / requiredFields) : 1,
      hackathons: hackathons.get(f.id) ?? [],
      peerRatings: ratings,
      milestones: founderMilestones(batch.settings.scoreMilestoneDueDates, {
        shortlistedCount: shortlisted.get(f.id)?.size ?? 0,
        reciprocalMetCount: reciprocalMetCount(f.id, metOf),
        batchSize: founders.length,
        startupFounderCount: f.startupId ? (startupFounderCount.get(f.startupId) ?? 0) : 0,
        // La grille Weekly founder.
        problemValidated: problemValidatedOf(reviews),
        weeklyGoal: weeklyGoalScore(reviews),
      }),
      supporters: supporters.get(f.id)?.size ?? 0,
      batchMaxSupporters,
      // Clear idea de sa startup : le critere de ses pitchs, sur 100.
      clearIdea: f.startupId ? (clearIdeaOf.get(f.startupId) ?? null) : null,
      hasExistingProject: directory?.hasExistingProject ?? null,
      hasExistingCoFounders: directory?.hasExistingCoFounders ?? null,
      background: internalOf.get(f.id)?.background ?? null,
    };
    const computed = computeFounderScore(inputs);
    executionOf.set(f.id, computed.subScores.execution);
    const scoreId = docIds.score("founder", f.id);
    const score: FounderScore = {
      ...scoped,
      targetType: "founder",
      targetId: f.id,
      subScores: computed.subScores,
      scale: HUB_SCORE_SCALE,
      dataCompleteness: computed.dataCompleteness,
      computedDateISOString: now,
    };
    write.set(db().doc(`${COL.scores}/${scoreId}`), score);
    const signals: ScoreSignals = { ...scoped, targetType: "founder", targetId: f.id, signals: computed.signals, computedDateISOString: now };
    write.set(db().doc(`${COL.scoreSignals}/${scoreId}`), signals);
    const att = attendance.get(f.id)!;
    const set = (m: Map<string, Set<string>>) => [...(m.get(f.id) ?? [])];
    const incoming = set(interestIn);
    const outgoing = set(interestOut);
    const wIn = set(workingIn);
    const wOut = set(workingOut);
    const stats: FounderStats = {
      ...scoped,
      attendance: { attended: att.attended, total: att.total, rate: att.total ? att.attended / att.total : null },
      interestIncoming: incoming,
      interestOutgoing: outgoing,
      interestMutual: incoming.filter((id) => outgoing.includes(id)),
      workingWithIncoming: wIn,
      workingWithOutgoing: wOut,
      workingWithMutual: wIn.filter((id) => wOut.includes(id)),
      uniqueTeammates: teammates.get(f.id)?.size ?? 0,
      peerRating: { average: mean(ratings), count: ratings.length },
      computedDateISOString: now,
    };
    write.set(db().doc(`${COL.founderStats}/${f.id}`), stats);
  }

  for (const startup of startups) {
    const members = startup.memberIds.filter((id) => founderIds.has(id));
    const computed = computeStartupScore({
      founderBackgrounds: members.flatMap((id) => ratedBackgroundScore(internalOf.get(id)?.background) ?? []),
      founderExecutions: members.flatMap((id) => executionOf.get(id) ?? []),
      weeklyTraction: weeklyTractionOf(reviewsOfStartup.get(startup.id) ?? []),
      // La grille Pitch : familles Team, Speed of execution, Market.
      pitches: pitchesOf.get(startup.id) ?? [],
    });
    const scoreId = docIds.score("startup", startup.id);
    const score: StartupScore = {
      ...scoped,
      targetType: "startup",
      targetId: startup.id,
      subScores: computed.subScores,
      scale: HUB_SCORE_SCALE,
      dataCompleteness: computed.dataCompleteness,
      computedDateISOString: now,
    };
    write.set(db().doc(`${COL.scores}/${scoreId}`), score);
    write.set(db().doc(`${COL.scoreSignals}/${scoreId}`), {
      ...scoped,
      targetType: "startup",
      targetId: startup.id,
      signals: computed.signals,
      computedDateISOString: now,
    } satisfies ScoreSignals);
  }
  await write.close();
  return { batchId, founders: founders.length, startups: startups.length, computedDateISOString: now };
}

/** Chaque nuit : les batchs a venir ou en cours dont le Hub calcule les scores. */
export async function recomputeActiveBatches(): Promise<BatchScoresResult[]> {
  const batches = await docs<Batch>(db().collection(COL.batches).where("status", "in", ["upcoming", "active"]));
  const out: BatchScoresResult[] = [];
  for (const b of batches) {
    if (b.archivedDateISOString !== null || b.settings.scoresSource === "imported") continue;
    out.push(await recomputeBatchScores(b.id));
  }
  return out;
}
