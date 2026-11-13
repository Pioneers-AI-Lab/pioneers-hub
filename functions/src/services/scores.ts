import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type DocumentData, type Query } from "firebase-admin/firestore";
import { COL, docIds, docPaths, eventCollectionPaths, SUB } from "../shared/collections";
import { eventRoster } from "../shared/attendance";
import { isWorkTeamEvent } from "../shared/events";
import { countRequiredFields, listMissingFields } from "../shared/fieldRegistry";
import { formAudience, formNeedsTeam } from "../shared/formRules";
import { COMMITMENT_STATUS_SCORES, computeFounderScore, computeStartupScore, type FounderScoreInputs } from "../shared/scoring";
import { countsAcrossHackathons } from "../shared/scoringRules";
import {
  isBatchParticipant,
  mean,
  programPerformance,
  type Attendance,
  type Batch,
  type CommitmentStatus,
  type Form,
  type FormCompletion,
  type Founder,
  type FounderDirectory,
  type FounderInternal,
  type FounderScore,
  type FounderStats,
  type FounderWeek,
  type KpiSeries,
  type Leaderboard,
  type Membership,
  type PeerRating,
  type Picks,
  type PioneersEvent,
  type ScoreSignals,
  type Startup,
  type StartupInternal,
  type StartupProfile,
  type StartupScore,
} from "../shared/types";

// ----------------------------
// services - les scores d'un batch (SPECS §5, §5.5)
// ----------------------------
// Le SEUL ecrivain de `scores`, `scoreSignals` et `founderStats` pour un batch
// dont les scores viennent du Hub (`settings.scoresSource !== "imported"`) :
// Spring 2026, recopie de l'ancien dashboard, n'est jamais touche.
// Tout le batch d'un coup : Likability se rapporte au maximum du batch, et
// Execution a la meilleure equipe. Trois declencheurs : chaque nuit
// (`nightlyScores`), a la publication d'un classement (`publishEventRanking`),
// et le bouton du staff (`recomputeBatchScores`). Formules : shared/scoring.ts.

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

  const [allFounders, events, forms, completions, weeks, memberships, boards, startups, picks] = await Promise.all([
    docs<Founder>(db().collection(COL.founders).where("batchId", "==", batchId)),
    docs<PioneersEvent>(db().collection(COL.events).where("batchId", "==", batchId)),
    docs<Form>(db().collection(COL.forms).where("batchId", "==", batchId)),
    docs<FormCompletion>(db().collection(COL.formCompletions).where("batchId", "==", batchId)),
    docs<FounderWeek>(db().collection(COL.founderWeeks).where("batchId", "==", batchId)),
    docs<Membership>(db().collection(COL.memberships).where("batchId", "==", batchId)),
    docs<Leaderboard>(db().collection(COL.leaderboards).where("batchId", "==", batchId)),
    docs<Startup>(db().collection(COL.startups).where("batchId", "==", batchId)),
    docs<Picks>(db().collection(COL.picks).where("batchId", "==", batchId)),
  ]);
  const founders = allFounders.filter((f) => isBatchParticipant(f, batchId));
  const founderIds = new Set(founders.map((f) => f.id));
  // Les evenements qui comptent : publies, non archives, deja commences.
  const pastEvents = events.filter((e) => e.archivedDateISOString === null && e.status !== "draft" && e.startDateISOString <= now);
  const eventById = new Map(events.map((e) => [e.id, e]));

  const [attendanceByEvent, peerRatings, directories, internals, startupInternals, startupProfiles, kpis] = await Promise.all([
    Promise.all(pastEvents.map(async (e) => [e.id, await docs<Attendance>(db().collection(eventCollectionPaths.attendance(e.id)))] as const)).then(
      (entries) => new Map(entries),
    ),
    // Les avis entre pairs : agreges ici, jamais lus ailleurs par le serveur (SPECS §4.8).
    Promise.all(
      pastEvents.filter(isWorkTeamEvent).map((e) => docs<PeerRating>(db().collection(`${COL.events}/${e.id}/${SUB.peerRatings}`))),
    ).then((lists) => lists.flat()),
    byIds<FounderDirectory>(founders.map((f) => docPaths.founderDirectory(f.id))),
    byIds<FounderInternal>(founders.map((f) => docPaths.founderInternal(f.id))),
    byIds<StartupInternal>(startups.map((s) => docPaths.startupInternal(s.id))),
    byIds<StartupProfile>(startups.map((s) => docPaths.startupProfile(s.id))),
    byIds<KpiSeries>(startups.map((s) => docPaths.kpiSeries(s.id))),
  ]);
  const directoryOf = new Map(founders.map((f, i) => [f.id, directories[i]]));
  const internalOf = new Map(founders.map((f, i) => [f.id, internals[i]]));
  const startupOf = new Map(startups.map((s, i) => [s.id, { startup: s, internal: startupInternals[i], profile: startupProfiles[i], kpi: kpis[i] }]));

  // ---- Presence : les evenements ou il etait attendu ; sans aucun marquage, tous presents.
  const attendance = new Map(founders.map((f) => [f.id, { attended: 0, total: 0 }]));
  for (const e of pastEvents) {
    const roster = eventRoster(batchId, e, founders, attendanceByEvent.get(e.id) ?? []);
    for (const row of roster.rows) {
      const a = attendance.get(row.founder.id)!;
      a.total += 1;
      if (row.status !== "absent") a.attended += 1;
    }
  }

  // ---- Formulaires a temps : echeance passee, non anonymes, ni jury ; repondu avant l'echeance.
  // Les membres des equipes publiees, par evenement ; et les equipes de travail (challenge), par evenement et equipe.
  const teamMembersOf = new Map<string, string[]>();
  const workTeams = new Map<string, string[]>();
  for (const m of memberships) {
    if (m.kind !== "event_team" || !m.eventId) continue;
    pushTo(teamMembersOf, m.eventId, m.founderId);
    const event = eventById.get(m.eventId);
    if (event && isWorkTeamEvent(event)) pushTo(workTeams, `${m.eventId}/${m.teamId}`, m.founderId);
  }
  const completedAt = new Map(completions.map((c) => [docIds.formCompletion(c.formId, c.founderId), c.completedDateISOString]));
  const formsOnTime = new Map(founders.map((f) => [f.id, { onTime: 0, expected: 0 }]));
  for (const form of forms) {
    const deadline = form.deadlineDateISOString;
    if (form.archivedDateISOString !== null || form.status === "draft" || !deadline || deadline > now) continue;
    const event = form.eventId ? (eventById.get(form.eventId) ?? null) : null;
    const audience = formAudience({
      identityCheck: form.identityCheck,
      needsTeam: formNeedsTeam(form),
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

  // ---- Execution : le score normalise de son equipe a chaque hackathon publie, dans l'ordre des hackathons.
  const hackathonScores = new Map(founders.map((f) => [f.id, [] as number[]]));
  const published = boards
    .filter(countsAcrossHackathons)
    .map((b) => ({ board: b, event: eventById.get(b.eventId) }))
    .filter((x) => x.event && x.event.archivedDateISOString === null)
    .sort((a, b) => a.event!.startDateISOString.localeCompare(b.event!.startDateISOString));
  for (const { board } of published) {
    for (const row of board.rows) for (const id of row.memberIds) hackathonScores.get(id)?.push(row.normalized ?? 0);
  }

  // ---- Reseau : picks, interet et « je travaille avec » (formulaires hebdomadaires), coequipiers, peer ratings.
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
  const bestStatus = new Map<string, CommitmentStatus>();
  for (const w of weeks) {
    for (const target of w.interestedInFounderIds ?? []) {
      addTo(interestIn, target, w.founderId);
      addTo(interestOut, w.founderId, target);
    }
    for (const target of w.workingWithFounderIds ?? []) {
      addTo(workingIn, target, w.founderId);
      addTo(workingOut, w.founderId, target);
    }
    const status = w.commitmentStatus ?? null;
    const best = bestStatus.get(w.founderId);
    if (status && (!best || COMMITMENT_STATUS_SCORES[status] > COMMITMENT_STATUS_SCORES[best])) bestStatus.set(w.founderId, status);
  }
  const teammates = countMap();
  for (const members of workTeams.values()) for (const a of members) for (const b of members) if (a !== b) addTo(teammates, a, b);
  const peer = new Map<string, number[]>();
  for (const r of peerRatings) pushTo(peer, r.rateeFounderId, r.rating);

  // Interet recu : picks, interet et « je travaille avec », fondateurs distincts (SP26 : interet + working with).
  const receivedOf = (id: string) => new Set([...(interestIn.get(id) ?? []), ...(workingIn.get(id) ?? [])]).size;
  const batchMaxInterest = Math.max(0, ...founders.map((f) => receivedOf(f.id)));
  const requiredFields = countRequiredFields("founder");

  const write = db().bulkWriter();
  const scoped = { programId: batch.programId, batchId };
  const performanceOf = new Map<string, number | null>();

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
    const s = f.startupId ? startupOf.get(f.startupId) : undefined;
    const ratings = peer.get(f.id) ?? [];
    const inputs: FounderScoreInputs = {
      attendance: attendance.get(f.id)!,
      formsOnTime: formsOnTime.get(f.id)!,
      profileCompleteness: requiredFields > 0 ? Math.max(0, (requiredFields - missingRequired) / requiredFields) : 1,
      hackathonScores: hackathonScores.get(f.id)!,
      interestReceived: receivedOf(f.id),
      batchMaxInterest,
      peerAverage: mean(ratings),
      peerCount: ratings.length,
      teamedUp: (s?.startup.memberIds.filter((id) => founderIds.has(id)).length ?? 0) > 1,
      commitmentStatus: bestStatus.get(f.id) ?? null,
      hasExistingProject: directory?.hasExistingProject ?? null,
      hasExistingCoFounders: directory?.hasExistingCoFounders ?? null,
      startup: s
        ? { clearIdea: s.internal?.clearIdea ?? null, highPotential: s.internal?.highPotential ?? null, achievementsScore: s.internal?.achievementsScore ?? null }
        : null,
      eloScore: internalOf.get(f.id)?.eloScore ?? null,
    };
    const computed = computeFounderScore(inputs);
    performanceOf.set(f.id, programPerformance(computed.subScores));
    const scoreId = docIds.score("founder", f.id);
    const score: FounderScore = {
      ...scoped,
      targetType: "founder",
      targetId: f.id,
      subScores: computed.subScores,
      // Le score de base d'onboarding attend sa grille (SPECS §12, question 6).
      baseline: { execution: null, founderSignal: null, pedigree: null, geography: null },
      baselineComputedDateISOString: null,
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
      peerRating: { average: inputs.peerAverage, count: ratings.length },
      computedDateISOString: now,
    };
    write.set(db().doc(`${COL.founderStats}/${f.id}`), stats);
  }

  for (const { startup, internal, profile, kpi } of startupOf.values()) {
    const members = startup.memberIds.filter((id) => founderIds.has(id));
    const market = profile?.marketAnalysis ?? null;
    const series = kpi?.series ?? {};
    const cash = series.totalAmountPaid ?? [];
    const bestWeeklyCash = Math.max(0, ...cash.slice(1).map((p, i) => p.value - cash[i].value));
    const hasTraction = cash.length > 0 || (series.activeUsers?.length ?? 0) > 0 || (series.conversationsDone?.length ?? 0) > 0;
    const computed = computeStartupScore({
      market: market ? { samMid: market.sam.mid, cagrMid: market.cagr.mid, competitors: market.competitors.length } : null,
      clearIdea: internal?.clearIdea ?? null,
      highPotential: internal?.highPotential ?? null,
      achievementsScore: internal?.achievementsScore ?? null,
      founderElos: members.flatMap((id) => internalOf.get(id)?.eloScore ?? []),
      founderPerformances: members.flatMap((id) => performanceOf.get(id) ?? []),
      traction: hasTraction
        ? {
            bestWeeklyCash,
            bestActiveUsers: Math.max(0, ...(series.activeUsers ?? []).map((p) => p.value)),
            totalConversations: (series.conversationsDone ?? []).reduce((sum, p) => sum + p.value, 0),
          }
        : null,
    });
    const scoreId = docIds.score("startup", startup.id);
    const score: StartupScore = {
      ...scoped,
      targetType: "startup",
      targetId: startup.id,
      subScores: computed.subScores,
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
