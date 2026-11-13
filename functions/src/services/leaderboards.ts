import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { COL, docPaths, eventCollectionPaths } from "../shared/collections";
import { eventMetrics, juryCriteria } from "../shared/forms";
import {
  isLateUnwaived,
  mean,
  scoringOf,
  weightedMean,
  type Criterion,
  type Evaluation,
  type Form,
  type Leaderboard,
  type LeaderboardRow,
  type Submission,
} from "../shared/types";
import { compareTeamPoints, normalizeToBest, scoreTeams } from "../shared/scoringRules";
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
// Le bareme de l'evenement (`scoring`, SPECS §4.2, decision du 13/11) classe
// d'abord : points par element (metriques et criteres du jury), 0 pour une
// soumission en retard ou un element mis a 0, puis les departages. Sinon, deux
// classements au choix (`rankingMetricKey`) :
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


export async function recomputeLeaderboard(eventId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const [event, forms] = await Promise.all([loadEvent(tx, eventId).catch(() => null), formsOf(tx, eventId)]);
    if (!event) return;
    const criteria = juryCriteria(forms);
    const scoring = scoringOf(event);
    const key = scoring ? null : (event.rankingMetricKey ?? null);
    // Une cle sans question (formulaire archive depuis) classe encore, sous sa cle.
    const metric = key ? (eventMetrics(forms).find((m) => m.key === key) ?? { key, label: key, unit: null }) : null;
    const boardRef = db().doc(docPaths.leaderboard(eventId));
    // Un bareme se publie apres la verification des preuves ; sans bareme, le classement est toujours public.
    const published = scoring ? event.leaderboardRevealDateISOString !== null : true;
    const emptyBoard = (): Leaderboard => ({
      programId: event.programId,
      batchId: event.batchId,
      eventId,
      metric: null,
      scoring,
      published,
      rows: [],
      computedDateISOString: new Date().toISOString(),
    });
    // Ni bareme, ni grille de jury, ni metrique de classement : pas de leaderboard ; un ancien se vide, sans rien relire.
    if (!scoring && !metric && criteria.length === 0) {
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
    const submittedAt = (id: string) => submissionOf.get(id)?.submittedDateISOString ?? "9";

    if (scoring) {
      // Une equipe entre au classement des qu'elle a soumis ou qu'un jure l'a notee.
      const entered = targets.filter((t) => submissionOf.has(t.id) || evaluationsOf.has(t.id));
      const teams = entered.map((t) => {
        const s = submissionOf.get(t.id);
        const evals = evaluationsOf.get(t.id) ?? [];
        const juryMeans: Record<string, number> = {};
        for (const c of criteria) {
          const m = mean(evals.flatMap((e) => (typeof e.scores[c.key] === "number" ? [e.scores[c.key]] : [])));
          if (m !== null) juryMeans[c.key] = m;
        }
        return { id: t.id, metrics: s?.metrics ?? {}, juryMeans, late: isLateUnwaived(s), zeroedItemKeys: s?.zeroedItemKeys ?? [] };
      });
      // `scoreTeams` garde l'ordre de ses entrees : chaque resultat retrouve son equipe par position.
      const scored = scoreTeams(scoring, criteria, teams).map((p, i) => ({ p, team: teams[i], target: entered[i] }));
      const rows: LeaderboardRow[] = scored
        .sort((a, b) => compareTeamPoints(scoring, a.p, b.p) || submittedAt(a.p.id).localeCompare(submittedAt(b.p.id)))
        .map(({ p, team, target }, i) => ({
          targetId: target.id,
          name: target.name,
          memberIds: target.memberIds,
          rankDelta: null,
          // Sur 10 : l'affichage commun des leaderboards.
          score: p.normalized / 10,
          rank: i + 1,
          criteriaScores: team.juryMeans,
          evaluationsCount: evaluationsOf.get(p.id)?.length ?? 0,
          points: p.points,
          total: p.total,
          late: team.late,
          normalized: p.normalized,
        }));
      tx.set(boardRef, { ...emptyBoard(), rows });
      return;
    }

    const unranked = targets.flatMap((t) => {
      const base = { targetId: t.id, name: t.name, memberIds: t.memberIds, rankDelta: null };
      if (metric) {
        const value = submissionOf.get(t.id)?.metrics?.[metric.key];
        return typeof value === "number" ? [{ row: { ...base, score: value, criteriaScores: {}, evaluationsCount: 0 }, tieBreak: 0 }] : [];
      }
      const evals = evaluationsOf.get(t.id) ?? [];
      const scores = evals.flatMap((e) => weightedMean(criteria.map((c) => [criterionScore(c, e.scores), c.weight] as const)) ?? []);
      const score = mean(scores);
      if (score === null) return [];
      const criteriaScores: Record<string, number> = {};
      for (const c of criteria) {
        const m = mean(evals.flatMap((e) => criterionScore(c, e.scores) ?? []));
        if (m !== null) criteriaScores[c.key] = m;
      }
      const row = { ...base, score, criteriaScores, evaluationsCount: scores.length };
      return [{ row, tieBreak: heaviest ? (criteriaScores[heaviest.key] ?? 0) : 0 }];
    });
    const top = Math.max(0, ...unranked.map((u) => u.row.score));
    const rows: LeaderboardRow[] = unranked
      .sort((a, b) => b.row.score - a.row.score || b.tieBreak - a.tieBreak || submittedAt(a.row.targetId).localeCompare(submittedAt(b.row.targetId)))
      .map(({ row }, i) => ({ ...row, rank: i + 1, normalized: normalizeToBest(row.score, top) }));

    tx.set(boardRef, { ...emptyBoard(), metric, rows });
  });
}

/**
 * Staff : publier (ou retirer) le classement d'un evenement a bareme, une fois
 * les preuves verifiees. Le classement devient visible des fondateurs (avec la
 * visibilite du batch) ; l'appelant relance ensuite le calcul des scores.
 */
export async function publishEventRanking(actorUid: string, eventIdRaw: unknown, publishRaw: unknown): Promise<{ batchId: string }> {
  const eventId = cleanId(eventIdRaw, "eventId");
  const publish = publishRaw !== false;
  const batchId = await db().runTransaction(async (tx) => {
    const event = await loadEvent(tx, eventId);
    if (!scoringOf(event)) throw new HttpsError("failed-precondition", "This event has no scoring: its ranking is always public.");
    const path = docPaths.event(eventId);
    const now = new Date().toISOString();
    const revealed = publish ? (event.leaderboardRevealDateISOString ?? now) : null;
    tx.update(db().doc(path), { leaderboardRevealDateISOString: revealed, updatedDateISOString: now });
    writeUiAudit(tx, actorUid, publish ? "event.publishRanking" : "event.unpublishRanking", path, { before: event.leaderboardRevealDateISOString, after: revealed });
    return event.batchId;
  });
  await recomputeLeaderboard(eventId);
  return { batchId };
}

/** Staff : ce qui classe l'evenement (notes du jury, ou une metrique de sa Submission), puis recalcul. */
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
