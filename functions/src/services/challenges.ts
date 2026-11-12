import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { COL, docPaths, eventCollectionPaths } from "../shared/collections";
import { DEBRIEF_LIMITS, type ChallengeTask, type PeerRatingInput, type TeamResults } from "../shared/callables";
import { isStaffViewer } from "../shared/access";
import {
  EVENT_KIND_FEATURES,
  emptySubmission,
  type EventTeam,
  type MetricSnapshot,
  type PeerRating,
  type PioneersEvent,
  type Submission,
  type SubmissionLink,
} from "../shared/types";
import { founderIdIn, founderIdOf, loadAccount } from "../api/viewer";
import { writeUiAudit } from "./audit";
import { loadEvent } from "./events";
import { recomputeLeaderboard } from "./leaderboards";
import { cleanId, cleanText, cleanUrl } from "./clean";
import { parisDay } from "./schemas";

// ----------------------------
// services - le Debrief d'un hackathon (SPECS §4.2, §4.3)
// ----------------------------
// Apres chaque hackathon (mecanique `team_challenge`) :
//   - chaque fondateur note ses coequipiers (`events/{id}/peerRatings`) :
//     `PEER_QUESTION`, 1 a 5, et une phrase ;
//   - l'equipe saisit ses resultats (`events/{id}/submissions/{teamId}`) : les
//     metriques declarees par l'evenement, les liens de preuve, l'URL du
//     produit, une note libre. Chaque metrique devient aussi un releve date
//     (`metricSnapshots`, source et chemin de la soumission).
// Le serveur verifie l'equipe (publiee, le fondateur en est membre) : le
// client ne choisit ni l'auteur d'un avis ni l'equipe d'un fondateur.
// Chaque ecriture laisse une ligne d'audit dans la meme transaction.
//
// Quand le Debrief s'ouvrira a l'API / au MCP : passer ces deux ecritures en
// `Operation` (plan / commit : apercu, idempotence), comme services/fields.ts.

const db = () => getFirestore();

const isStarted = (event: PioneersEvent) => event.startDateISOString <= new Date().toISOString();

/** L'evenement d'un Debrief : une mecanique a equipes et soumissions, deja commencee. */
async function loadChallenge(eventIdRaw: unknown) {
  const eventId = cleanId(eventIdRaw, "eventId");
  const event = { id: eventId, ...(await loadEvent(null, eventId)) };
  const features = EVENT_KIND_FEATURES[event.kind];
  if (!features.teams || !features.submissions) throw new HttpsError("failed-precondition", "This event has no team debrief.");
  if (!isStarted(event)) throw new HttpsError("failed-precondition", "The event has not started yet.");
  return { event, features };
}

/** L'equipe publiee de ce fondateur a cet evenement, ou `null`. */
async function teamOf(eventId: string, founderId: string) {
  const teams = await db().collection(eventCollectionPaths.teams(eventId)).where("memberIds", "array-contains", founderId).get();
  const published = teams.docs.find((d) => (d.data() as EventTeam).publishedDateISOString !== null);
  return published ? { id: published.id, ...(published.data() as EventTeam) } : null;
}

export async function myChallengeTasks(uid: string, batchIdRaw: unknown): Promise<ChallengeTask[]> {
  const batchId = cleanId(batchIdRaw, "batchId");
  const [founderId, events] = await Promise.all([
    founderIdOf(uid, batchId),
    db().collection(COL.events).where("batchId", "==", batchId).where("kind", "==", "team_challenge").get(),
  ]);
  if (!founderId) return [];

  const started = events.docs
    .map((d) => ({ id: d.id, ...(d.data() as PioneersEvent) }))
    .filter((e) => e.archivedDateISOString === null && isStarted(e))
    .sort((a, b) => b.startDateISOString.localeCompare(a.startDateISOString));
  const teams = await Promise.all(started.map((e) => teamOf(e.id, founderId)));
  const joined = started.flatMap((event, i) => {
    const team = teams[i];
    return team ? [{ event, team, teammateIds: team.memberIds.filter((id) => id !== founderId) }] : [];
  });

  // Une seule lecture groupee : pour chaque equipe, sa soumission puis les avis deja donnes.
  const refs = joined.flatMap(({ event, team, teammateIds }) => [
    db().doc(docPaths.submission(event.id, team.id)),
    ...teammateIds.map((id) => db().doc(docPaths.peerRating(event.id, founderId, id))),
  ]);
  const snaps = refs.length ? await db().getAll(...refs) : [];
  let cursor = 0;
  return joined.map(({ event, team, teammateIds }): ChallengeTask => {
    const s = snaps[cursor++].data() as Submission | undefined;
    const myRatings: ChallengeTask["myRatings"] = {};
    for (const snap of snaps.slice(cursor, (cursor += teammateIds.length))) {
      const r = snap.data() as PeerRating | undefined;
      if (r) myRatings[r.rateeFounderId] = { rating: r.rating, comment: r.comment };
    }
    return {
      eventId: event.id,
      eventName: event.name,
      startDateISOString: event.startDateISOString,
      metrics: event.metrics,
      team: { id: team.id, name: team.name, teammateIds },
      myRatings,
      results: s ? { metrics: s.metrics ?? {}, links: s.links ?? [], productUrl: s.productUrl ?? null, notes: s.notes ?? null } : null,
    };
  });
}

export async function submitPeerRatings(uid: string, eventIdRaw: unknown, inputs: unknown): Promise<number> {
  const [{ event, features }, account] = await Promise.all([loadChallenge(eventIdRaw), loadAccount(uid)]);
  if (!features.peerRatings) throw new HttpsError("failed-precondition", "No peer ratings for this event.");
  const founderId = founderIdIn(account, event.batchId);
  if (!founderId) throw new HttpsError("permission-denied", "Only a founder of this batch can rate teammates.");
  const team = await teamOf(event.id, founderId);
  if (!team) throw new HttpsError("permission-denied", "You were not in a team at this event.");

  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > team.memberIds.length) {
    throw new HttpsError("invalid-argument", "`ratings` must list your teammates.");
  }
  const ratings = (inputs as Partial<PeerRatingInput>[]).map((r) => {
    const rateeFounderId = String(r?.rateeFounderId ?? "");
    const rating = r?.rating;
    if (rateeFounderId === founderId) throw new HttpsError("invalid-argument", "You cannot rate yourself.");
    if (!team.memberIds.includes(rateeFounderId)) throw new HttpsError("invalid-argument", "You can only rate members of your team.");
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new HttpsError("invalid-argument", "A rating is a whole number from 1 to 5.");
    }
    return { rateeFounderId, rating, comment: cleanText(r?.comment, DEBRIEF_LIMITS.peerComment, "comment") };
  });
  if (new Set(ratings.map((r) => r.rateeFounderId)).size !== ratings.length) {
    throw new HttpsError("invalid-argument", "Each teammate can be rated once.");
  }

  const now = new Date().toISOString();
  await db().runTransaction(async (tx) => {
    for (const r of ratings) {
      const doc: PeerRating = {
        programId: event.programId,
        batchId: event.batchId,
        raterFounderId: founderId,
        rateeFounderId: r.rateeFounderId,
        teamId: team.id,
        rating: r.rating,
        comment: r.comment,
        submittedDateISOString: now,
      };
      tx.set(db().doc(docPaths.peerRating(event.id, founderId, r.rateeFounderId)), doc);
    }
    // L'audit ne recopie pas les notes : les avis individuels restent dans `peerRatings`.
    writeUiAudit(tx, uid, "peerRatings.submit", `${docPaths.event(event.id)}/peerRatings`, {
      raterFounderId: founderId,
      teamId: team.id,
      count: ratings.length,
    });
  });
  return ratings.length;
}

/** Les resultats recus, valides : seulement les metriques de l'evenement ; une valeur vide retire la metrique. */
function cleanResults(event: PioneersEvent, input: Partial<TeamResults>): TeamResults {
  const declared = new Set(event.metrics.map((m) => m.key));
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.metrics ?? {})) {
    if (!declared.has(key)) throw new HttpsError("invalid-argument", `\`${key}\` is not a metric of this event.`);
    if (value === null || value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new HttpsError("invalid-argument", `\`${key}\` must be a number, 0 or more.`);
    }
    metrics[key] = value;
  }
  const rawLinks = Array.isArray(input.links) ? input.links : [];
  if (rawLinks.length > DEBRIEF_LIMITS.resultLinks) {
    throw new HttpsError("invalid-argument", `At most ${DEBRIEF_LIMITS.resultLinks} links.`);
  }
  const links = rawLinks.map((l, i): SubmissionLink => {
    const url = cleanUrl(l?.url, `links[${i}].url`);
    if (!url) throw new HttpsError("invalid-argument", `\`links[${i}].url\` is required.`);
    return { label: cleanText(l?.label, DEBRIEF_LIMITS.linkLabel, `links[${i}].label`) ?? `Link ${i + 1}`, url };
  });
  return {
    metrics,
    links,
    productUrl: cleanUrl(input.productUrl, "productUrl"),
    notes: cleanText(input.notes, DEBRIEF_LIMITS.resultNotes, "notes"),
  };
}

export async function submitTeamResults(
  uid: string,
  eventIdRaw: unknown,
  teamIdRaw: unknown,
  input: Partial<TeamResults>,
): Promise<void> {
  const teamId = cleanId(teamIdRaw, "teamId");
  const [{ event }, account] = await Promise.all([loadChallenge(eventIdRaw), loadAccount(uid)]);
  const teamSnap = await db().doc(docPaths.team(event.id, teamId)).get();
  if (!teamSnap.exists) throw new HttpsError("not-found", "No such team.");
  const team = teamSnap.data() as EventTeam;

  const founderId = founderIdIn(account, event.batchId);
  // Regle propre a cette callable (les regles Firestore reservent les soumissions au staff).
  const isMember = founderId !== null && team.memberIds.includes(founderId);
  if (!isMember && !isStaffViewer(account.viewer)) {
    throw new HttpsError("permission-denied", "Only a member of this team or the staff can enter its results.");
  }
  const source: MetricSnapshot["source"] = isMember ? "self_reported" : "staff";
  const results = cleanResults(event, input);

  const now = new Date().toISOString();
  const day = parisDay(event.startDateISOString);
  const submissionRef = db().doc(docPaths.submission(event.id, teamId));
  await db().runTransaction(async (tx) => {
    const previous = (await tx.get(submissionRef)).data() as Submission | undefined;
    // Les autres champs de la soumission (titre, liens du pitch, livrables) sont gardes.
    const submission: Submission = {
      ...emptySubmission(teamId),
      ...previous,
      teamId,
      ...results,
      submittedDateISOString: now,
    };
    tx.set(submissionRef, submission);
    // Un releve par metrique, a id deterministe : une nouvelle saisie remplace la precedente.
    for (const [metric, value] of Object.entries(results.metrics)) {
      const snapshot: MetricSnapshot = {
        programId: event.programId,
        batchId: event.batchId,
        subjectType: "event_team",
        subjectId: teamId,
        founderIds: team.memberIds,
        eventId: event.id,
        metric,
        value,
        dayString: day,
        phase: null,
        source,
        proofUrl: results.links[0]?.url ?? null,
        sourcePath: submissionRef.path,
        recordedByUid: uid,
        recordedDateISOString: now,
      };
      tx.set(db().doc(docPaths.metricSnapshot(teamId, metric, day, null)), snapshot);
    }
    writeUiAudit(tx, uid, "submission.results", submissionRef.path, {
      metrics: results.metrics,
      links: results.links.length,
      productUrl: results.productUrl,
      notes: results.notes,
    });
  });
  // Classement par metrique, ou departage du jury par l'heure de soumission.
  await recomputeLeaderboard(event.id);
}
