import { getFirestore } from "firebase-admin/firestore";
import { docPaths } from "../shared/collections";
import type { Evaluation, EventTeam, MetricSnapshot, PioneersEvent, Submission } from "../shared/types";
import { sameIds } from "../shared/kpis";
import { recomputeLeaderboard } from "./leaderboards";
import { parisDay } from "./schemas";

// ----------------------------
// services - les resultats d'une equipe, quel que soit leur ecrivain (SPECS §4.2)
// ----------------------------
// Declencheurs `onSubmissionWritten` (events/{id}/submissions/{teamId}) et
// `onEvaluationWritten` (notes du jury), quel que soit l'ecrivain : le Debrief
// ou le jury (formulaires), le staff qui corrige, l'API. Chaque metrique devient
// un releve date (`metricSnapshots`, id deterministe : une nouvelle saisie
// remplace la precedente), puis le leaderboard est recalcule (classement par
// metrique, ou departage du jury par l'heure de soumission).

const db = () => getFirestore();

/**
 * Ce qui a change compte : une note ou un lien edite ne reecrit aucun releve et
 * ne recalcule rien ; seules les metriques changees deviennent des releves. Le
 * leaderboard suit une metrique changee ou une nouvelle heure de soumission
 * (departage du jury).
 */
export async function onSubmissionChange(eventId: string, teamId: string, before: Submission | null, after: Submission | null): Promise<void> {
  const changed = Object.entries(after?.metrics ?? {}).filter(([metric, value]) => typeof value === "number" && before?.metrics?.[metric] !== value);
  const metricsRemoved = Object.keys(before?.metrics ?? {}).some((metric) => after?.metrics?.[metric] === undefined);
  // Le bareme lit aussi le retard, son exception et les elements mis a 0 par le staff.
  const scoringInputsChanged =
    before?.late !== after?.late ||
    before?.lateWaived !== after?.lateWaived ||
    !sameIds(before?.zeroedItemKeys, after?.zeroedItemKeys);
  if (changed.length === 0 && !metricsRemoved && !scoringInputsChanged && before?.submittedDateISOString === after?.submittedDateISOString) return;

  if (after && changed.length > 0) {
    const [eventSnap, teamSnap] = await db().getAll(db().doc(docPaths.event(eventId)), db().doc(docPaths.team(eventId, teamId)), {
      fieldMask: ["programId", "batchId", "startDateISOString", "memberIds"],
    });
    const event = eventSnap.data() as Pick<PioneersEvent, "programId" | "batchId" | "startDateISOString"> | undefined;
    if (event) {
      const team = teamSnap.data() as Pick<EventTeam, "memberIds"> | undefined;
      const day = parisDay(event.startDateISOString);
      const batch = db().batch();
      for (const [metric, value] of changed) {
        const snapshot: MetricSnapshot = {
          programId: event.programId,
          batchId: event.batchId,
          subjectType: "event_team",
          subjectId: teamId,
          founderIds: team?.memberIds ?? [],
          eventId,
          metric,
          value,
          dayString: day,
          phase: null,
          source: after.recordedSource ?? "self_reported",
          proofUrl: after.proofUrls?.[0] ?? null,
          sourcePath: docPaths.submission(eventId, teamId),
          recordedByUid: after.recordedByUid ?? null,
          recordedDateISOString: after.submittedDateISOString ?? new Date().toISOString(),
        };
        batch.set(db().doc(docPaths.metricSnapshot(teamId, metric, day, null)), snapshot);
      }
      await batch.commit();
    }
  }
  await recomputeLeaderboard(eventId);
}

/** Une note du jury : le leaderboard ne suit que des notes changees (pas un commentaire). */
export async function onEvaluationChange(eventId: string, before: Pick<Evaluation, "scores"> | null, after: Pick<Evaluation, "scores"> | null): Promise<void> {
  if (before && after && JSON.stringify(before.scores) === JSON.stringify(after.scores)) return;
  await recomputeLeaderboard(eventId);
}
