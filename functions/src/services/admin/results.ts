import { z } from "zod";
import { outstandingWrite, teamResultsWrite } from "../../shared/admin/results";
import { COL, docPaths, eventCollectionPaths } from "../../shared/collections";
import { FAMILY_KEY } from "../../shared/fieldRegistry";
import type { Evaluation, EventTeam, FormResponse, Leaderboard, PioneersEvent, Submission } from "../../shared/types";
import { badRequest, notFound } from "../../api/errors";
import { decideFormWrite as decide } from "../forms";
import { deleteJuryScore as deleteScore, resetJuryLink as resetLink } from "../judges";
import { publishEventRanking, ScoringItemSchema, setEventRanking, setEventScoring } from "../leaderboards";
import type { Operation } from "../operations";
import { httpUrl } from "../schemas";
import { changesOf, effectPlan, mustRead, readDoc, staffOnly, writePlan } from "./writes";

// ----------------------------
// services/admin - resultats d'equipe, jury, classement, reponses en attente
// ----------------------------
// Admin > Events > un evenement (Results, Jury, Leaderboard) et Admin > Forms
// (reponses a valider). Les resultats se calculent par shared/admin/results.ts ;
// le jury, le bareme et la publication du classement appellent LES services des
// callables (memes regles, audit au nom de l'appelant) ; ces services recalculent
// le leaderboard, et les scores du batch si le classement compte.

const teamTarget = { eventId: z.string().min(1), teamId: z.string().min(1).describe("The group's id (`get event`: teams).") };

async function teamOf(tx: FirebaseFirestore.Transaction, eventId: string, teamId: string) {
  const [event, team, submission] = await Promise.all([
    mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId"),
    readDoc<EventTeam>(tx, docPaths.team(eventId, teamId)),
    readDoc<Submission>(tx, docPaths.submission(eventId, teamId)),
  ]);
  if (!team) throw notFound("team_not_found", `No group \`${teamId}\` in this event.`, "teamId");
  return { event, team, submission };
}

// ---- Resultats d'une equipe ------------------------------------------------------------

export const SetTeamResultsInput = z
  .object({
    ...teamTarget,
    metrics: z.record(z.string().regex(FAMILY_KEY), z.number().finite().min(0)).optional().describe("Team metrics by key (`get event`: the Debrief's `submission.metrics.<key>`). Replaces the keys given, keeps the others."),
    productUrl: httpUrl.nullable().optional(),
    proofUrls: z.array(httpUrl).max(20).optional().describe("Replaces the list."),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();

export const setTeamResults: Operation<typeof SetTeamResultsInput> = {
  name: "set_team_results",
  input: SetTeamResultsInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId, teamId, metrics, productUrl, proofUrls, notes }) {
    const { event, team, submission } = await teamOf(tx, eventId, teamId);
    const patch = {
      ...(metrics ? { metrics: { ...(submission?.metrics ?? {}), ...metrics } } : {}),
      ...(productUrl !== undefined ? { productUrl } : {}),
      ...(proofUrls ? { proofUrls } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };
    const changes = changesOf(submission ?? {}, patch);
    return writePlan(
      { event: event.name, team: team.name, changes, note: "Recorded as a staff correction; the leaderboard and metric series follow." },
      [teamResultsWrite(eventId, teamId, submission ?? null, patch, caller.uid, new Date().toISOString())],
      { eventId, teamId },
      Object.keys(changes).length > 0,
    );
  },
};

export const SetOutstandingInput = z.object({ ...teamTarget, outstanding: z.boolean() }).strict();

export const setOutstanding: Operation<typeof SetOutstandingInput> = {
  name: "set_outstanding",
  input: SetOutstandingInput,
  allowed: staffOnly,
  async plan(tx, _caller, { eventId, teamId, outstanding }) {
    // La ligne du leaderboard ne se lit que pour donner la mention (elle seule exige le maximum de la grille).
    const [{ event, team, submission }, leaderboard] = await Promise.all([
      teamOf(tx, eventId, teamId),
      outstanding ? readDoc<Leaderboard>(tx, docPaths.leaderboard(eventId)) : undefined,
    ]);
    const eligible = leaderboard?.rows.find((r) => r.targetId === teamId)?.outstandingEligible === true;
    return writePlan(
      { event: event.name, team: team.name, outstanding },
      [outstandingWrite(eventId, teamId, outstanding, { hasSubmission: submission !== undefined, eligible })],
      { eventId, teamId },
      (submission?.outstanding === true) !== outstanding,
    );
  },
};

// ---- Jury ------------------------------------------------------------------------------------

export const DeleteJuryScoreInput = z
  .object({ eventId: z.string().min(1), evaluationId: z.string().min(1).describe("From `get event` (evaluations).") })
  .strict();

export const deleteJuryScore: Operation<typeof DeleteJuryScoreInput> = {
  name: "delete_jury_score",
  input: DeleteJuryScoreInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId, evaluationId }) {
    const [event, evaluation] = await Promise.all([
      mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId"),
      readDoc<Evaluation>(tx, `${eventCollectionPaths.evaluations(eventId)}/${evaluationId}`),
    ]);
    if (!evaluation) throw notFound("evaluation_not_found", "No such jury score (already removed?).", "evaluationId");
    return effectPlan(
      { event: event.name, removes: { judge: evaluation.evaluatorName, target: evaluation.targetId, scores: evaluation.scores }, note: "Deleted for good (kept whole in the audit log); the leaderboard follows." },
      [`${eventCollectionPaths.evaluations(eventId)}/${evaluationId}`],
      () => deleteScore(caller, eventId, evaluationId).then(() => ({ eventId, evaluationId })),
    );
  },
};

export const EventIdInput = z.object({ eventId: z.string().min(1) }).strict();

export const resetJuryLink: Operation<typeof EventIdInput> = {
  name: "reset_jury_link",
  input: EventIdInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId }) {
    const event = await mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId");
    return effectPlan(
      { event: event.name, does: "replaces the shared jury link: the old one stops working at once. The new link is copied from the app (never shown here)." },
      [docPaths.juryLink(eventId)],
      () => resetLink(caller, eventId).then(() => ({ eventId })),
    );
  },
};

// ---- Classement ------------------------------------------------------------------------------

export const SetEventScoringInput = z
  .object({ eventId: z.string().min(1), items: z.array(ScoringItemSchema).max(20).describe("The full grid. Empty removes it (the ranking goes back to jury scores or the chosen metric).") })
  .strict();

export const setEventScoringAction: Operation<typeof SetEventScoringInput> = {
  name: "set_event_scoring",
  input: SetEventScoringInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId, items }) {
    const event = await mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId");
    // Les scores du batch suivent dans le service si le classement est publie.
    return effectPlan({ event: event.name, from: event.scoring ?? null, to: items.length ? items : null }, [docPaths.event(eventId)], () => setEventScoring(caller, eventId, { items }));
  },
};

export const SetRankingMetricInput = z
  .object({ eventId: z.string().min(1), metricKey: z.string().min(1).nullable().describe("A team metric of the event's forms, or null: ranked by jury scores.") })
  .strict();

export const setRankingMetric: Operation<typeof SetRankingMetricInput> = {
  name: "set_ranking_metric",
  input: SetRankingMetricInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId, metricKey }) {
    const event = await mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId");
    return effectPlan(
      { event: event.name, from: event.rankingMetricKey ?? null, to: metricKey },
      [docPaths.event(eventId)],
      () => setEventRanking(caller, eventId, metricKey).then(() => ({ eventId })),
      (event.rankingMetricKey ?? null) !== metricKey,
    );
  },
};

export const PublishRankingInput = z
  .object({ eventId: z.string().min(1), publish: z.boolean().describe("true: the batch sees the ranking (top 3 on Leaderboard) and scores are recomputed. false: hide it again.") })
  .strict();

export const publishRanking: Operation<typeof PublishRankingInput> = {
  name: "publish_ranking",
  input: PublishRankingInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId, publish }) {
    const event = await mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId");
    if (!event.scoring) throw badRequest("no_scoring", "This event has no scoring grid: its ranking is always public.", "eventId");
    return effectPlan(
      { event: event.name, publish, note: publish ? "The batch's scores are recomputed." : undefined },
      [docPaths.event(eventId)],
      () => publishEventRanking(caller, eventId, publish),
      (event.leaderboardRevealDateISOString != null) !== publish,
    );
  },
};

// ---- Reponses en attente de validation ----------------------------------------------------------

export const DecideFormWriteInput = z
  .object({
    responseId: z.string().min(1).describe("From list `responses`."),
    writeIndex: z.number().int().min(0).describe("The pending value's index in the response's `writes`."),
    approve: z.boolean().describe("true: write it to the database (checked again against today's data); false: reject it."),
  })
  .strict();

export const decideFormWrite: Operation<typeof DecideFormWriteInput> = {
  name: "decide_form_write",
  input: DecideFormWriteInput,
  allowed: staffOnly,
  async plan(tx, caller, { responseId, writeIndex, approve }) {
    const response = await mustRead<FormResponse>(tx, `${COL.formResponses}/${responseId}`, "response", "responseId");
    const write = response.writes[writeIndex];
    if (!write) throw notFound("write_not_found", "This response has no such value.", "writeIndex");
    if (write.status !== "pending_approval") throw badRequest("already_decided", "This value was already decided.", "writeIndex");
    return effectPlan(
      { field: write.dbField, value: write.value, target: write.targetId ?? null, decision: approve ? "approve (written now)" : "reject" },
      [`${COL.formResponses}/${responseId}`],
      () => decide(caller, { responseId, writeIndex, approve }),
    );
  },
};
