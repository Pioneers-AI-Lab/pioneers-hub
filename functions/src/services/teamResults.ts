import { getFirestore } from "firebase-admin/firestore";
import { COL, docPaths } from "../shared/collections";
import { juryTargetOf } from "../shared/events";
import { eventMetrics, juryCriteria } from "../shared/forms";
import type { Evaluation, EventTeam, Form, MetricSnapshot, PioneersEvent, Startup, Submission } from "../shared/types";
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
// Declencheur `onFormWritten` : la grille du jury et les metriques sont les
// questions des formulaires de l'evenement ; une echelle, un poids, une question
// ajoutee ou retiree recalcule le classement.

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
  // Le leaderboard lit aussi le retard (affiche), l'Outstanding mention et les elements mis a 0 par le staff.
  const scoringInputsChanged =
    before?.late !== after?.late ||
    before?.outstanding !== after?.outstanding ||
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

type RankedTeam = Pick<EventTeam, "name" | "memberIds" | "publishedDateISOString">;

/**
 * Une equipe d'un tirage publie retouchee (absent retire, retard ajoute, echange, renommee) :
 * le leaderboard copie ses membres et son nom, il suit. Un brouillon ne classe rien : ignore.
 */
export async function onTeamChange(eventId: string, before: RankedTeam | null, after: RankedTeam | null): Promise<void> {
  if (!before?.publishedDateISOString && !after?.publishedDateISOString) return;
  if (before && after && before.name === after.name && sameIds(before.memberIds, after.memberIds)) return;
  await recomputeLeaderboard(eventId);
}

type RankedStartup = Pick<Startup, "name" | "memberIds">;

/**
 * Une startup renommee ou dont l'equipe change : les leaderboards qui la classent (evenements
 * sans matching, ses `startupIds` : pitchs) copient son nom et ses membres, ils suivent.
 */
export async function onStartupChange(startupId: string, before: RankedStartup, after: RankedStartup): Promise<void> {
  if (before.name === after.name && sameIds(before.memberIds, after.memberIds)) return;
  const events = await db()
    .collection(COL.events)
    .where("startupIds", "array-contains", startupId)
    .select("kind", "matching", "teamSize", "archivedDateISOString")
    .get();
  const ranking = events.docs.filter((d) => !d.get("archivedDateISOString") && juryTargetOf(d.data() as PioneersEvent) === "startup");
  await Promise.all(ranking.map((d) => recomputeLeaderboard(d.id)));
}

type RankedEvent = Pick<PioneersEvent, "kind" | "matching" | "teamSize" | "startupIds">;

/**
 * Un evenement dont les cibles changent (startups ajoutees ou retirees, matching pose ou retire),
 * quel que soit l'ecrivain (ecran Admin, `update_event`, `set_matching`) : son leaderboard suit.
 * Bareme et metrique de classement recalculent deja eux-memes (services/leaderboards.ts).
 */
export async function onEventChange(eventId: string, before: RankedEvent, after: RankedEvent): Promise<void> {
  const target = juryTargetOf(after);
  if (target === juryTargetOf(before) && (target === "team" || sameIds(before.startupIds, after.startupIds))) return;
  await recomputeLeaderboard(eventId);
}

type ScoringForm = Pick<Form, "eventId" | "questions" | "archivedDateISOString">;

/** Ce qu'un formulaire apporte au leaderboard : son evenement, sa grille de jury et ses metriques. */
const rankingInputs = (form: ScoringForm | null) => JSON.stringify(form ? [form.eventId, juryCriteria([form]), eventMetrics([form])] : null);

/** Un formulaire d'evenement : le leaderboard ne suit qu'une grille ou des metriques changees (pas des dates ni un titre). */
export async function onFormChange(before: ScoringForm | null, after: ScoringForm | null): Promise<void> {
  const eventIds = new Set([before?.eventId, after?.eventId].filter((id): id is string => Boolean(id)));
  if (eventIds.size === 0 || rankingInputs(before) === rankingInputs(after)) return;
  // Rattache a un autre evenement : l'ancien perd la grille, le nouveau la gagne.
  await Promise.all([...eventIds].map(recomputeLeaderboard));
}
