import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { COL, docPaths, eventCollectionPaths } from "../shared/collections";
import { eventMetrics, juryCriteria } from "../shared/forms";
import {
  weightedMean,
  type Criterion,
  type Evaluation,
  type Form,
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
// client). Recalcule apres chaque saisie qui le change : resultats d'une equipe
// et note d'un jure (declencheurs `onSubmissionWritten`, `onEvaluationWritten` :
// tout ecrivain est couvert), changement du critere de classement.
//
// La grille et les metriques sont les questions des formulaires de l'evenement
// (SPECS §2) : la grille, celles de son formulaire de jury (poids sur la
// question) ; les metriques, celles de son Debrief.
//
// Deux classements, au choix de l'evenement (`rankingMetricKey`) :
//   - les notes du jury (par defaut) : pour chaque evaluation, la moyenne
//     ponderee des criteres ramenes sur 10 ; puis la moyenne entre evaluations.
//     Egalite : le critere le plus lourd, puis l'heure de soumission ;
//   - une metrique de l'evenement (conversations, argent encaisse) : la valeur
//     saisie dans la soumission. Egalite : l'heure de soumission.
// Les avis entre pairs n'y entrent jamais.

const db = () => getFirestore();

/** Les formulaires de l'evenement (grille du jury, metriques du Debrief). */
async function formsOf(tx: Transaction, eventId: string): Promise<Form[]> {
  const snap = await tx.get(db().collection(COL.forms).where("eventId", "==", eventId));
  return snap.docs.map((d) => d.data() as Form);
}

/** Une note ramenee sur 10 selon l'echelle du critere. */
const on10 = (c: Criterion, v: number) => (c.max === c.min ? 10 : ((v - c.min) / (c.max - c.min)) * 10);

/** La note du critere `c` dans une evaluation, sur 10, ou `null` s'il n'est pas note. */
const criterionScore = (c: Criterion, scores: Record<string, number>) => (typeof scores[c.key] === "number" ? on10(c, scores[c.key]) : null);

const average = (values: number[]) => weightedMean(values.map((v) => [v, 1] as const));

export async function recomputeLeaderboard(eventId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const [event, forms] = await Promise.all([loadEvent(tx, eventId).catch(() => null), formsOf(tx, eventId)]);
    if (!event) return;
    const criteria = juryCriteria(forms);
    const key = event.rankingMetricKey ?? null;
    // Une cle sans question (formulaire archive depuis) classe encore, sous sa cle.
    const metric = key ? (eventMetrics(forms).find((m) => m.key === key) ?? { key, label: key, unit: null }) : null;
    const boardRef = db().doc(docPaths.leaderboard(eventId));
    const emptyBoard = (): Leaderboard => ({ programId: event.programId, batchId: event.batchId, eventId, metric: null, rows: [], computedDateISOString: new Date().toISOString() });
    // Ni grille de jury ni metrique de classement : pas de leaderboard ; un ancien se vide, sans rien relire.
    if (!metric && criteria.length === 0) {
      if ((await tx.get(boardRef)).exists) tx.set(boardRef, emptyBoard());
      return;
    }
    // Ce qui est attache classe (SPECS §2) : les groupes du matching, ou les startups de l'evenement.
    const [targets, submissions, evaluations] = await Promise.all([
      scoredTargets(tx, eventId, event),
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
    const heaviest = [...criteria].sort((a, b) => b.weight - a.weight)[0] ?? null;

    const unranked = targets.flatMap((t) => {
      const base = { targetId: t.id, name: t.name, memberIds: t.memberIds, rankDelta: null };
      if (metric) {
        const value = submissionOf.get(t.id)?.metrics?.[metric.key];
        return typeof value === "number" ? [{ row: { ...base, score: value, criteriaScores: {}, evaluationsCount: 0 }, tieBreak: 0 }] : [];
      }
      const evals = evaluationsOf.get(t.id) ?? [];
      const scores = evals.flatMap((e) => weightedMean(criteria.map((c) => [criterionScore(c, e.scores), c.weight] as const)) ?? []);
      const score = average(scores);
      if (score === null) return [];
      const criteriaScores: Record<string, number> = {};
      for (const c of criteria) {
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

    tx.set(boardRef, { ...emptyBoard(), metric, rows });
  });
}

/** Staff : ce qui classe l'evenement (notes du jury, ou une metrique de son Debrief), puis recalcul. */
export async function setEventRanking(actorUid: string, eventIdRaw: unknown, metricKeyRaw: unknown): Promise<void> {
  const eventId = cleanId(eventIdRaw, "eventId");
  const metricKey = metricKeyRaw === null || metricKeyRaw === undefined ? null : String(metricKeyRaw);
  await db().runTransaction(async (tx) => {
    const event = await loadEvent(tx, eventId);
    if (metricKey !== null && !eventMetrics(await formsOf(tx, eventId)).some((m) => m.key === metricKey)) {
      throw new HttpsError("invalid-argument", `\`${metricKey}\` is not a metric of this event.`);
    }
    const path = docPaths.event(eventId);
    tx.update(db().doc(path), { rankingMetricKey: metricKey, updatedDateISOString: new Date().toISOString() });
    writeUiAudit(tx, actorUid, "event.setRanking", path, { before: event.rankingMetricKey ?? null, after: metricKey });
  });
  await recomputeLeaderboard(eventId);
}
