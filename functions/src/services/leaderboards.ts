import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { COL, docPaths, eventCollectionPaths } from "../shared/collections";
import { eventMetrics, juryCriteria } from "../shared/forms";
import {
  mean,
  pushTo,
  scoringOf,
  weightedMean,
  type Criterion,
  type Evaluation,
  type Form,
  type Leaderboard,
  type LeaderboardRow,
  type Submission,
} from "../shared/types";
import { z } from "zod";
import { FAMILY_KEY } from "../shared/fieldRegistry";
import { recomputeBatchScores } from "./scores";
import { compareTeamPoints, normalizeToBest, scoredTeamOf, scoreTeams, scoringFrom, scoringProblems } from "../shared/scoringRules";
import { writeUiAudit, type AuditActor } from "./audit";
import { cleanId, invalidArgument } from "./clean";
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
// d'abord : points par element (metriques et criteres du jury), 0 pour un
// element mis a 0, puis les departages. Sinon, deux
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
    // Un bareme se publie une fois le jury passe ; sans bareme, le classement est toujours public.
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
      pushTo(evaluationsOf, e.targetId, e);
    }
    const heaviest = [...criteria].sort((a, b) => b.weight - a.weight)[0] ?? null;
    const submittedAt = (id: string) => submissionOf.get(id)?.submittedDateISOString ?? "9";

    if (scoring) {
      // Toutes les equipes y sont (20/11) : sans Submission ni note, 0, qui compte dans l'Execution une
      // fois publie ; le staff verifie donc le classement que les fondateurs verront.
      const keys = criteria.map((c) => c.key);
      const teams = targets.map((t) => scoredTeamOf(t.id, submissionOf.get(t.id), evaluationsOf.get(t.id) ?? [], keys));
      // `scoreTeams` garde l'ordre de ses entrees : chaque resultat retrouve son equipe par position.
      const scored = scoreTeams(scoring, criteria, teams).map((p, i) => ({ p, team: teams[i], target: targets[i] }));
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
          late: submissionOf.get(p.id)?.late === true,
          normalized: p.normalized,
          outstanding: p.outstanding,
          outstandingEligible: p.outstandingEligible,
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
 * visibilite du batch), puis les scores du batch sont recalcules.
 */
export async function publishEventRanking(actor: string | AuditActor, eventIdRaw: unknown, publishRaw: unknown): Promise<{ batchId: string }> {
  const eventId = cleanId(eventIdRaw, "eventId");
  const publish = publishRaw !== false;
  const batchId = await db().runTransaction(async (tx) => {
    const event = await loadEvent(tx, eventId);
    if (!scoringOf(event)) throw new HttpsError("failed-precondition", "This event has no scoring: its ranking is always public.");
    const path = docPaths.event(eventId);
    const now = new Date().toISOString();
    const revealed = publish ? (event.leaderboardRevealDateISOString ?? now) : null;
    tx.update(db().doc(path), { leaderboardRevealDateISOString: revealed, updatedDateISOString: now });
    writeUiAudit(tx, actor, publish ? "event.publishRanking" : "event.unpublishRanking", path, { before: event.leaderboardRevealDateISOString, after: revealed });
    return event.batchId;
  });
  await recomputeLeaderboard(eventId);
  // L'Execution suit le classement publie (SPECS §5.5) : tous les appelants (callable, API).
  await recomputeScoresAfter(batchId);
  return { batchId };
}

/** Un classement publie compte dans les scores du batch : ils suivent son changement (une erreur est journalisee, pas levee). */
const recomputeScoresAfter = (batchId: string) =>
  recomputeBatchScores(batchId).then(
    () => undefined,
    (e) => console.error("recomputeBatchScores after ranking", e),
  );

// `call()` (src/lib/firebase.ts) retire deja les cles `undefined` que le SDK enverrait en `null` ; le schema
// accepte quand meme `null` (barèmes deja stockes, anciens clients) sans en faire une regle pour les autres.
export const ScoringItemSchema = z.object({
  label: z.string().trim().min(1).max(80),
  mode: z
    .enum(["per_unit", "proportional", "criterion"])
    .describe("`criterion`: a jury criterion's points (the standard); `proportional`/`per_unit`: legacy, kept only if already there."),
  sourceKey: z.string().regex(FAMILY_KEY).describe("The jury criterion or team metric key (from the event's forms)."),
  pointsPerUnit: z.number().finite().min(0).max(1_000_000).nullish(),
  maxPoints: z.number().finite().min(0).max(1_000_000).nullish(),
  tieBreakOnly: z
    .boolean()
    .nullish()
    .transform((v) => v === true)
    .describe("A tie-break, in order, not counted in the total."),
});
const ScoringSchema = z.object({ items: z.array(ScoringItemSchema).max(20) });

/**
 * Staff : le bareme d'un evenement (Admin > Events > Leaderboard). Chaque
 * element vise une variable des formulaires de l'evenement ; les departages
 * sont ses elements « tie-break only », dans l'ordre. Un bareme vide le retire :
 * le classement revient aux notes du jury (ou a la metrique choisie). Journalise,
 * puis recalcul du classement, et des scores du batch s'il est publie.
 */
export async function setEventScoring(actor: string | AuditActor, eventIdRaw: unknown, scoringRaw: unknown): Promise<{ batchId: string; published: boolean }> {
  const eventId = cleanId(eventIdRaw, "eventId");
  const parsed = ScoringSchema.safeParse(scoringRaw ?? { items: [] });
  if (!parsed.success) throw invalidArgument("scoring", `${parsed.error.issues[0]?.message ?? "invalid"}.`);
  const scoring = scoringFrom(parsed.data.items);
  const result = await db().runTransaction(async (tx) => {
    const [event, forms] = await Promise.all([loadEvent(tx, eventId), formsOf(tx, eventId)]);
    if (scoring) {
      // Les anciens elements (points par unite, proportionnels) ne se gardent que s'ils y sont deja (17/11).
      const problems = scoringProblems(scoring, eventMetrics(forms), juryCriteria(forms), scoringOf(event));
      if (problems.length) throw new HttpsError("invalid-argument", problems[0]);
    }
    const path = docPaths.event(eventId);
    // Sans bareme, le classement est toujours public : la publication repart de zero.
    const patch = scoring ? { scoring, rankingMetricKey: null } : { scoring: null, leaderboardRevealDateISOString: null };
    tx.update(db().doc(path), { ...patch, updatedDateISOString: new Date().toISOString() });
    writeUiAudit(tx, actor, "event.setScoring", path, { before: event.scoring ?? null, after: scoring });
    // Un classement publie compte dans les scores du batch : avant comme apres, ils suivent.
    return { batchId: event.batchId, published: event.leaderboardRevealDateISOString !== null };
  });
  await recomputeLeaderboard(eventId);
  if (result.published) await recomputeScoresAfter(result.batchId);
  return result;
}

/** Staff : ce qui classe l'evenement (notes du jury, ou une metrique de sa Submission), puis recalcul. */
export async function setEventRanking(actor: string | AuditActor, eventIdRaw: unknown, metricKeyRaw: unknown): Promise<void> {
  const eventId = cleanId(eventIdRaw, "eventId");
  const metricKey = metricKeyRaw === null || metricKeyRaw === undefined ? null : String(metricKeyRaw);
  await db().runTransaction(async (tx) => {
    const event = await loadEvent(tx, eventId);
    if (metricKey !== null && !eventMetrics(await formsOf(tx, eventId)).some((m) => m.key === metricKey)) {
      throw new HttpsError("invalid-argument", `\`${metricKey}\` is not a metric of this event.`);
    }
    const path = docPaths.event(eventId);
    tx.update(db().doc(path), { rankingMetricKey: metricKey, updatedDateISOString: new Date().toISOString() });
    writeUiAudit(tx, actor, "event.setRanking", path, { before: event.rankingMetricKey ?? null, after: metricKey });
  });
  await recomputeLeaderboard(eventId);
}
