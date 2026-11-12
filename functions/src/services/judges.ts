import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { docPaths, eventCollectionPaths } from "../shared/collections";
import { JUDGE_LIMITS, type JudgeKey, type JudgeSheet } from "../shared/callables";
import { publicShortName } from "../shared/access";
import { judgeLinkState, juryTarget, type Evaluation, type EventTeam, type Founder, type Judge, type PioneersEvent } from "../shared/types";
import { secret, sha256 } from "../api/crypto";
import { writeUiAudit } from "./audit";
import { cleanId, cleanText } from "./clean";
import { loadEvent, scoredTargets } from "./events";
import { recomputeLeaderboard } from "./leaderboards";
import { parisEndOfNextDay } from "./schemas";

// ----------------------------
// services - le jury par lien prive (SPECS §4.2)
// ----------------------------
// Un jure n'a pas de compte : le staff cree son lien, `/judge/{eventId}/{judgeId}#{secret}`.
// Le secret suit en fragment (jamais envoye au serveur web ni dans un referent) ;
// seule son empreinte est stockee (`judges/{judgeId}.tokenHash`, lisible du seul staff).
// Le lien expire le lendemain de l'evenement et le staff peut le revoquer.
// Un jure ne note pas les cibles dont il est exclu (sa propre equipe), corrige
// ses notes jusqu'au verrouillage (`locked`), et chaque saisie est journalisee.
// Ses notes vont dans `evaluations/{judgeId}_{targetId}`, puis le leaderboard
// est recalcule.

const db = () => getFirestore();
/** Statuts ou les notes sont encore ouvertes. */
const OPEN_STATUSES: PioneersEvent["status"][] = ["draft", "scheduled", "live"];

/** La cible du jury de l'evenement ; refuse un evenement sans jury ou sans grille. */
function juryOf(event: PioneersEvent) {
  const target = juryTarget(event.kind);
  if (!target) throw new HttpsError("failed-precondition", "This event has no jury.");
  if (event.criteria.length === 0) throw new HttpsError("failed-precondition", "This event has no scoring grid yet.");
  return target;
}

export async function createJudge(
  actorUid: string,
  input: { eventId?: unknown; name?: unknown; email?: unknown; excludedTargetIds?: unknown },
) {
  const eventId = cleanId(input.eventId, "eventId");
  const name = cleanText(input.name, JUDGE_LIMITS.name, "name");
  if (!name) throw new HttpsError("invalid-argument", "`name` is required.");
  const email = cleanText(input.email, 200, "email")?.toLowerCase() ?? null;
  const excludedTargetIds = Array.isArray(input.excludedTargetIds)
    ? [...new Set(input.excludedTargetIds.map((id, i) => cleanId(id, `excludedTargetIds[${i}]`)))]
    : [];
  const event = await loadEvent(null, eventId);
  juryOf(event);

  const key = secret();
  const now = new Date().toISOString();
  const judge: Judge = {
    name,
    email,
    createdByUid: actorUid,
    createdDateISOString: now,
    tokenHash: sha256(key),
    expiresDateISOString: parisEndOfNextDay(event.endDateISOString ?? event.startDateISOString),
    revokedDateISOString: null,
    excludedTargetIds,
  };
  const ref = db().collection(docPaths.judges(eventId)).doc();
  await db().runTransaction(async (tx) => {
    tx.create(ref, judge);
    writeUiAudit(tx, actorUid, "judge.create", ref.path, { name, email, excludedTargetIds });
  });
  return { judgeId: ref.id, key, expiresDateISOString: judge.expiresDateISOString };
}

export async function revokeJudge(actorUid: string, eventIdRaw: unknown, judgeIdRaw: unknown) {
  const ref = db().doc(docPaths.judge(cleanId(eventIdRaw, "eventId"), cleanId(judgeIdRaw, "judgeId")));
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "No such judge.");
    if ((snap.data() as Judge).revokedDateISOString) return;
    tx.update(ref, { revokedDateISOString: new Date().toISOString() });
    writeUiAudit(tx, actorUid, "judge.revoke", ref.path, {});
  });
}

/** Le jure de ce lien, s'il est valide. Toute erreur dit la meme chose : rien sur ce qui a echoue. */
async function authenticate(input: Partial<JudgeKey>) {
  const eventId = cleanId(input.eventId, "eventId");
  const judgeId = cleanId(input.judgeId, "judgeId");
  // L'evenement se lit en meme temps : il ne quitte le serveur qu'une fois le secret verifie.
  const [judgeSnap, eventSnap] = await db().getAll(db().doc(docPaths.judge(eventId, judgeId)), db().doc(docPaths.event(eventId)));
  const judge = judgeSnap.data() as Judge | undefined;
  const event = eventSnap.data() as PioneersEvent | undefined;
  if (
    !judge ||
    !event ||
    typeof input.key !== "string" ||
    sha256(input.key) !== judge.tokenHash ||
    judgeLinkState(judge, new Date().toISOString()) !== "active"
  ) {
    throw new HttpsError("permission-denied", "This judging link is not valid any more. Ask the Pioneers team for a new one.");
  }
  return { eventId, judgeId, judge, event, target: juryOf(event) };
}

export async function getJudgeSheet(input: Partial<JudgeKey>): Promise<JudgeSheet> {
  const { eventId, judgeId, judge, event, target } = await authenticate(input);
  const excluded = new Set(judge.excludedTargetIds);
  const [all, evaluations] = await Promise.all([
    scoredTargets(null, eventId, event, target),
    db().collection(eventCollectionPaths.evaluations(eventId)).where("evaluatorId", "==", judgeId).get(),
  ]);
  const targets = all.filter((t) => !excluded.has(t.id));
  // Les equipes publiees avant les noms courts : on les calcule depuis les fiches.
  const missing = [...new Set(targets.filter((t) => target === "team" && !t.memberNames).flatMap((t) => t.memberIds))];
  const founders = missing.length ? await db().getAll(...missing.map((id) => db().doc(docPaths.founder(id)))) : [];
  const shortName = new Map(founders.map((f) => [f.id, publicShortName((f.data() as Founder | undefined)?.name ?? "")]));

  const scores: JudgeSheet["scores"] = {};
  for (const d of evaluations.docs) {
    const e = d.data() as Evaluation;
    scores[e.targetId] = { scores: e.scores, comment: e.comment };
  }
  return {
    judgeName: judge.name,
    eventName: event.name,
    startDateISOString: event.startDateISOString,
    canEdit: OPEN_STATUSES.includes(event.status),
    criteria: event.criteria,
    targets: targets.map((t) => ({
      id: t.id,
      name: t.name,
      members: target === "team" ? (t.memberNames ?? t.memberIds.map((id) => shortName.get(id) ?? "")) : [],
    })),
    scores,
  };
}

/** La cible fait partie de ce que ce jure peut noter (meme regle que `scoredTargets`, pour une seule cible). */
async function canScore(eventId: string, event: PioneersEvent, target: "team" | "startup", judge: Judge, targetId: string) {
  if (judge.excludedTargetIds.includes(targetId)) return false;
  if (target === "startup") return event.startupIds.includes(targetId);
  const team = (await db().doc(docPaths.team(eventId, targetId)).get()).data() as EventTeam | undefined;
  return team !== undefined && team.publishedDateISOString !== null;
}

export async function submitJudgeScores(
  input: Partial<JudgeKey> & { targetId?: unknown; scores?: unknown; comment?: unknown },
): Promise<void> {
  const { eventId, judgeId, judge, event, target } = await authenticate(input);
  if (!OPEN_STATUSES.includes(event.status)) throw new HttpsError("failed-precondition", "Scores are locked for this event.");
  const targetId = cleanId(input.targetId, "targetId");
  if (!(await canScore(eventId, event, target, judge, targetId))) throw new HttpsError("invalid-argument", "You cannot score this one.");
  const raw = (input.scores ?? {}) as Record<string, unknown>;
  const scores: Record<string, number> = {};
  for (const c of event.criteria) {
    const v = raw[c.key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < c.min || v > c.max) {
      throw new HttpsError("invalid-argument", `\`${c.label}\` needs a score from ${c.min} to ${c.max}.`);
    }
    scores[c.key] = v;
  }
  const comment = cleanText(input.comment, JUDGE_LIMITS.comment, "comment");

  const ref = db().doc(docPaths.evaluation(eventId, judgeId, targetId));
  await db().runTransaction(async (tx) => {
    const before = (await tx.get(ref)).data() as Evaluation | undefined;
    const evaluation: Evaluation = {
      evaluatorKind: "judge",
      evaluatorId: judgeId,
      evaluatorName: judge.name,
      isExternal: true,
      targetType: target,
      targetId,
      scores,
      overallScore: null,
      wouldInvest: null,
      betLikelihood: null,
      wantsToContinue: null,
      comment,
      decision: null,
      finalDecision: null,
      updatedDateISOString: new Date().toISOString(),
    };
    tx.set(ref, evaluation);
    // Chaque modification est tracee : avant / apres.
    writeUiAudit(tx, `judge:${judgeId}`, before ? "evaluation.update" : "evaluation.create", ref.path, {
      before: before ? { scores: before.scores, comment: before.comment } : null,
      after: { scores, comment },
    });
  });
  await recomputeLeaderboard(eventId);
}
