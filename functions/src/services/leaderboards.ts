import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { docPaths, eventCollectionPaths } from "../shared/collections";
import {
  EVENT_KIND_FEATURES,
  juryTarget,
  weightedMean,
  type Criterion,
  type Evaluation,
  type Leaderboard,
  type LeaderboardRow,
  type Submission,
} from "../shared/types";
import { writeUiAudit } from "./audit";
import { cleanId } from "./clean";
import { loadEvent, scoredTargets } from "./events";

// ----------------------------
// services - le leaderboard d'un evenement (SPECS §4.2)
// ----------------------------
// Le SEUL endroit qui ecrit `leaderboards/{eventId}` (les regles refusent tout
// client). Recalcule apres chaque saisie qui le change : resultats d'une equipe,
// note d'un jure, changement du critere de classement.
//
// Deux classements, au choix de l'evenement (`rankingMetricKey`) :
//   - les notes du jury (par defaut) : pour chaque evaluation, la moyenne
//     ponderee des criteres ramenes sur 10 ; puis la moyenne entre evaluations.
//     Egalite : le critere le plus lourd, puis l'heure de soumission ;
//   - une metrique de l'evenement (conversations, argent encaisse) : la valeur
//     saisie dans la soumission. Egalite : l'heure de soumission.
// Les avis entre pairs n'y entrent jamais.

const db = () => getFirestore();

/** Une note ramenee sur 10 selon l'echelle du critere. */
const on10 = (c: Criterion, v: number) => (c.max === c.min ? 10 : ((v - c.min) / (c.max - c.min)) * 10);

/** La note du critere `c` dans une evaluation, sur 10, ou `null` s'il n'est pas note. */
const criterionScore = (c: Criterion, scores: Record<string, number>) => (typeof scores[c.key] === "number" ? on10(c, scores[c.key]) : null);

const average = (values: number[]) => weightedMean(values.map((v) => [v, 1] as const));

export async function recomputeLeaderboard(eventId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const event = await loadEvent(tx, eventId).catch(() => null);
    const target = event ? juryTarget(event.kind) : null;
    if (!event || !target || !EVENT_KIND_FEATURES[event.kind].leaderboard) return;

    const metric = event.metrics.find((m) => m.key === event.rankingMetricKey) ?? null;
    const [targets, submissions, evaluations] = await Promise.all([
      scoredTargets(tx, eventId, event, target),
      tx.get(db().collection(eventCollectionPaths.submissions(eventId))),
      // Classement par metrique : les notes du jury ne servent pas.
      metric ? null : tx.get(db().collection(eventCollectionPaths.evaluations(eventId))),
    ]);
    const submissionOf = new Map(submissions.docs.map((d) => [d.id, d.data() as Submission]));
    const evaluationsOf = new Map<string, Evaluation[]>();
    for (const d of evaluations?.docs ?? []) {
      const e = d.data() as Evaluation;
      const list = evaluationsOf.get(e.targetId) ?? [];
      list.push(e);
      evaluationsOf.set(e.targetId, list);
    }
    const heaviest = [...event.criteria].sort((a, b) => b.weight - a.weight)[0] ?? null;

    const unranked = targets.flatMap((t) => {
      const base = { targetId: t.id, name: t.name, memberIds: t.memberIds, rankDelta: null };
      if (metric) {
        const value = submissionOf.get(t.id)?.metrics?.[metric.key];
        return typeof value === "number" ? [{ row: { ...base, score: value, criteriaScores: {}, evaluationsCount: 0 }, tieBreak: 0 }] : [];
      }
      const evals = evaluationsOf.get(t.id) ?? [];
      const scores = evals.flatMap((e) => weightedMean(event.criteria.map((c) => [criterionScore(c, e.scores), c.weight] as const)) ?? []);
      const score = average(scores);
      if (score === null) return [];
      const criteriaScores: Record<string, number> = {};
      for (const c of event.criteria) {
        const mean = average(evals.flatMap((e) => criterionScore(c, e.scores) ?? []));
        if (mean !== null) criteriaScores[c.key] = mean;
      }
      const row = { ...base, score, criteriaScores, evaluationsCount: scores.length };
      return [{ row, tieBreak: heaviest ? (criteriaScores[heaviest.key] ?? 0) : 0 }];
    });
    const submittedAt = (id: string) => submissionOf.get(id)?.submittedDateISOString ?? "9";
    const rows: LeaderboardRow[] = unranked
      .sort((a, b) => b.row.score - a.row.score || b.tieBreak - a.tieBreak || submittedAt(a.row.targetId).localeCompare(submittedAt(b.row.targetId)))
      .map(({ row }, i) => ({ ...row, rank: i + 1 }));

    const board: Leaderboard = {
      programId: event.programId,
      batchId: event.batchId,
      eventId,
      metric,
      rows,
      computedDateISOString: new Date().toISOString(),
    };
    tx.set(db().doc(docPaths.leaderboard(eventId)), board);
  });
}

/** Staff : ce qui classe l'evenement (notes du jury, ou une de ses metriques), puis recalcul. */
export async function setEventRanking(actorUid: string, eventIdRaw: unknown, metricKeyRaw: unknown): Promise<void> {
  const eventId = cleanId(eventIdRaw, "eventId");
  const metricKey = metricKeyRaw === null || metricKeyRaw === undefined ? null : String(metricKeyRaw);
  await db().runTransaction(async (tx) => {
    const event = await loadEvent(tx, eventId);
    if (!EVENT_KIND_FEATURES[event.kind].leaderboard) throw new HttpsError("failed-precondition", "This event has no leaderboard.");
    if (metricKey !== null && !event.metrics.some((m) => m.key === metricKey)) {
      throw new HttpsError("invalid-argument", `\`${metricKey}\` is not a metric of this event.`);
    }
    const path = docPaths.event(eventId);
    tx.update(db().doc(path), { rankingMetricKey: metricKey, updatedDateISOString: new Date().toISOString() });
    writeUiAudit(tx, actorUid, "event.setRanking", path, { before: event.rankingMetricKey ?? null, after: metricKey });
  });
  await recomputeLeaderboard(eventId);
}
