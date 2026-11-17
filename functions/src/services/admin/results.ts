import { z } from "zod";
import { lateWaivedWrite, outstandingWrite, teamResultsWrite } from "../../shared/admin/results";
import { COL, docPaths, eventCollectionPaths } from "../../shared/collections";
import { normalizeHttpUrl } from "../../shared/text";
import type { Evaluation, EventTeam, FormResponse, Leaderboard, PioneersEvent, Submission } from "../../shared/types";
import { badRequest, notFound } from "../../api/errors";
import { decideFormWrite as decide } from "../forms";
import { deleteJuryScore as deleteScore, resetJuryLink as resetLink } from "../judges";
import { publishEventRanking, setEventRanking, setEventScoring } from "../leaderboards";
import type { Operation } from "../operations";
import { recomputeBatchScores } from "../scores";
import { changesOf, mustRead, readDoc, staffOnly, writePlan } from "./writes";

// ----------------------------
// services/admin - resultats d'equipe, jury, classement, reponses en attente
// ----------------------------
// Admin > Events > un evenement (Results, Jury, Leaderboard) et Admin > Forms
// (reponses a valider). Les resultats se calculent par shared/admin/results.ts ;
// le jury, le bareme et la publication du classement appellent LES services des
// callables (memes regles, audit au nom de l'appelant), puis recalculent comme
// eux : le leaderboard suit, et les scores du batch si le classement compte.

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
    metrics: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), z.number().finite().min(0)).optional().describe("Team metrics by key (`get event`: the Debrief's `submission.metrics.<key>`). Replaces the keys given, keeps the others."),
    productUrl: z.string().trim().min(1).max(2000).nullable().optional(),
    proofUrls: z.array(z.string().trim().min(1).max(2000)).max(20).optional().describe("Replaces the list."),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();

export const setTeamResults: Operation<typeof SetTeamResultsInput> = {
  name: "set_team_results",
  input: SetTeamResultsInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId, teamId, metrics, productUrl, proofUrls, notes }) {
    const { event, team, submission } = await teamOf(tx, eventId, teamId);
    const url = (v: string) => {
      const ok = normalizeHttpUrl(v);
      if (!ok) throw badRequest("invalid_url", `\`${v}\` is not a web address.`, "proofUrls");
      return ok;
    };
    const patch = {
      ...(metrics ? { metrics: { ...(submission?.metrics ?? {}), ...metrics } } : {}),
      ...(productUrl !== undefined ? { productUrl: productUrl === null ? null : url(productUrl) } : {}),
      ...(proofUrls ? { proofUrls: proofUrls.map(url) } : {}),
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

export const WaiveLateInput = z.object({ ...teamTarget, waived: z.boolean().describe("true: the late Submission counts (otherwise the grid gives it 0).") }).strict();

export const waiveLate: Operation<typeof WaiveLateInput> = {
  name: "waive_late",
  input: WaiveLateInput,
  allowed: staffOnly,
  async plan(tx, _caller, { eventId, teamId, waived }) {
    const { event, team, submission } = await teamOf(tx, eventId, teamId);
    if (!submission?.late) throw badRequest("not_late", `${team.name}'s Submission was not late.`, "teamId");
    return writePlan({ event: event.name, team: team.name, waived }, [lateWaivedWrite(eventId, teamId, waived)], { eventId, teamId }, (submission.lateWaived === true) !== waived);
  },
};

export const SetOutstandingInput = z.object({ ...teamTarget, outstanding: z.boolean() }).strict();

export const setOutstanding: Operation<typeof SetOutstandingInput> = {
  name: "set_outstanding",
  input: SetOutstandingInput,
  allowed: staffOnly,
  async plan(tx, _caller, { eventId, teamId, outstanding }) {
    const [{ event, team, submission }, leaderboard] = await Promise.all([teamOf(tx, eventId, teamId), readDoc<Leaderboard>(tx, docPaths.leaderboard(eventId))]);
    // Comme l'ecran : la mention n'est proposee qu'a une equipe qui a le maximum de la grille.
    if (outstanding && !leaderboard?.rows.find((r) => r.targetId === teamId)?.outstandingEligible) {
      throw badRequest("not_eligible", `The Outstanding mention goes only to a team with the grid's maximum; ${team.name} does not have it.`, "teamId");
    }
    return writePlan({ event: event.name, team: team.name, outstanding }, [outstandingWrite(eventId, teamId, outstanding, submission !== undefined)], { eventId, teamId }, (submission?.outstanding === true) !== outstanding);
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
    return {
      preview: { event: event.name, removes: { judge: evaluation.evaluatorName, target: evaluation.targetId, scores: evaluation.scores }, note: "Deleted for good (kept whole in the audit log); the leaderboard follows." },
      targetPaths: [`${eventCollectionPaths.evaluations(eventId)}/${evaluationId}`],
      effect: () => deleteScore(caller, eventId, evaluationId).then(() => ({ eventId, evaluationId })),
      effectAudits: true,
    };
  },
};

export const EventIdInput = z.object({ eventId: z.string().min(1) }).strict();

export const resetJuryLink: Operation<typeof EventIdInput> = {
  name: "reset_jury_link",
  input: EventIdInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId }) {
    const event = await mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId");
    return {
      preview: { event: event.name, does: "replaces the shared jury link: the old one stops working at once. The new link is copied from the app (never shown here)." },
      targetPaths: [docPaths.juryLink(eventId)],
      effect: () => resetLink(caller, eventId).then(() => ({ eventId })),
      effectAudits: true,
    };
  },
};

// ---- Classement ------------------------------------------------------------------------------

const ScoringItem = z
  .object({
    label: z.string().trim().min(1).max(80),
    mode: z.enum(["criterion", "proportional", "per_unit"]).describe("`criterion`: a jury criterion's points (the standard); `proportional`/`per_unit`: legacy, kept only if already there."),
    sourceKey: z.string().min(1).describe("The jury criterion or team metric key (from the event's forms)."),
    maxPoints: z.number().finite().min(0).max(1_000_000).optional(),
    pointsPerUnit: z.number().finite().min(0).max(1_000_000).optional(),
    tieBreakOnly: z.boolean().optional().describe("A tie-break, in order, not counted in the total."),
  })
  .strict();

export const SetEventScoringInput = z
  .object({ eventId: z.string().min(1), items: z.array(ScoringItem).max(20).describe("The full grid. Empty removes it (the ranking goes back to jury scores or the chosen metric).") })
  .strict();

/** Un classement publie compte dans les scores du batch : apres un changement, ils suivent (comme les callables). */
const withScores = async <T extends { batchId: string }>(done: T, recompute: boolean) => {
  if (recompute) await recomputeBatchScores(done.batchId).catch((e) => console.error("recomputeBatchScores after ranking", e));
  return done;
};

export const setEventScoringAction: Operation<typeof SetEventScoringInput> = {
  name: "set_event_scoring",
  input: SetEventScoringInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId, items }) {
    const event = await mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId");
    return {
      preview: { event: event.name, from: event.scoring ?? null, to: items.length ? items : null },
      targetPaths: [docPaths.event(eventId)],
      effect: async () => {
        const done = await setEventScoring(caller, eventId, { items });
        return withScores(done, done.published);
      },
      effectAudits: true,
    };
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
    const isSame = (event.rankingMetricKey ?? null) === metricKey;
    return {
      preview: { event: event.name, from: event.rankingMetricKey ?? null, to: metricKey },
      targetPaths: [docPaths.event(eventId)],
      ...(isSame ? {} : { effect: () => setEventRanking(caller, eventId, metricKey).then(() => ({ eventId })), effectAudits: true }),
    };
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
    const isSame = (event.leaderboardRevealDateISOString != null) === publish;
    return {
      preview: { event: event.name, publish },
      targetPaths: [docPaths.event(eventId)],
      ...(isSame ? {} : { effect: async () => withScores(await publishEventRanking(caller, eventId, publish), true), effectAudits: true }),
    };
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
    return {
      preview: { field: write.dbField, value: write.value, target: write.targetId ?? null, decision: approve ? "approve (written now)" : "reject" },
      targetPaths: [`${COL.formResponses}/${responseId}`],
      effect: () => decide(caller, { responseId, writeIndex, approve }),
      effectAudits: true,
    };
  },
};
