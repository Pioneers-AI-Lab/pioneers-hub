import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { juryAnswersPlan, juryFormOf, juryGridOf } from "../../shared/admin/jury";
import { COL, docPaths, eventCollectionPaths } from "../../shared/collections";
import { juryTargetOf } from "../../shared/events";
import { briefMetricRanks } from "../../shared/juryBrief";
import { EVALUATION_DECISIONS, type Evaluation, type Form, type Person, type PioneersEvent, type Submission, type User } from "../../shared/types";
import type { Caller } from "../../api/caller";
import { sha256 } from "../../api/crypto";
import { badRequest, forbidden } from "../../api/errors";
import { scoredTargets } from "../events";
import { submitFormResponse } from "../forms";
import { loadJuryFollowUp, namedJudgeId } from "../jury";
import { stableStringify, type Operation } from "../operations";
import { effectPlan, mustRead, readWhere, staffOnly } from "./writes";

// ----------------------------
// services/admin - noter un jury avec Claude (staff, decision du 18/11)
// ----------------------------
// `pioneers_get` `jury_sheet` : la fiche de notation d'un evenement, soit la
// grille du formulaire de jury et, pour chaque cible (equipe publiee ou startup de
// l'evenement, `scoredTargets` : la liste du jury et du leaderboard), CE QUE LIT
// UN JURE (`loadJuryBrief` : Submission et Drive, ou Pitch deck), plus le nombre
// de notes deja recues et les siennes. `score_jury` : toutes les notes en une
// fois, apercu en table, puis envoi PAR LE FORMULAIRE DE JURY (`submitFormResponse`)
// sous le nom complet du staff : memes controles, meme jure que par le lien.
//
// ⛔️ Jamais ici : les avis entre pairs, les picks, ni les notes des autres jures
// une par une (seulement leur nombre et le total projete).

/** Le nom complet d'un compte staff, comme la liste du lien de jury : sa personne, sinon son compte. Jamais l'email. */
async function staffFullName(uid: string): Promise<string> {
  const db = getFirestore();
  const user = (await db.doc(docPaths.user(uid)).get()).data() as Pick<User, "personId"> | undefined;
  const [person, auth] = await Promise.all([
    user?.personId ? db.doc(docPaths.person(user.personId)).get() : null,
    getAuth()
      .getUser(uid)
      .catch(() => null),
  ]);
  const name = ((person?.data() as Pick<Person, "displayName"> | undefined)?.displayName ?? auth?.displayName ?? "").trim();
  if (!name) throw badRequest("no_name", "Your account has no name: add it to your profile, so the jury shows who scored.", "eventId");
  return name;
}

/** Le formulaire de jury de l'evenement, ses cibles et ses notes. */
async function juryContext(tx: Transaction, eventId: string) {
  const db = getFirestore();
  const [event, forms, evaluations] = await Promise.all([
    mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId"),
    readWhere<Form>(tx, COL.forms, "eventId", eventId),
    tx.get(db.collection(eventCollectionPaths.evaluations(eventId))).then((s) => s.docs.map((d) => ({ ...(d.data() as Evaluation), id: d.id }))),
  ]);
  const form = juryFormOf(forms);
  if (!form) throw badRequest("no_jury_form", "This event has no jury form (a form with jury criteria): add one first.", "eventId");
  const targets = await scoredTargets(tx, eventId, event);
  return { event, form, grid: juryGridOf(form), targets, evaluations };
}


// ---- Lire : la fiche de notation --------------------------------------------------

/**
 * `scored` : deja note par ce staff ; `to_score` : rendu, tous ses formulaires remplis ; `incomplete` : un formulaire
 * manque (`owes`) ; `waiting` : rendu, mais un formulaire qui l'attend n'est pas encore ouvert ; `no_submission` : rien rendu.
 */
const JURY_TARGET_STATUSES = ["to_score", "incomplete", "waiting", "no_submission", "scored"] as const;
type JuryTargetStatus = (typeof JURY_TARGET_STATUSES)[number];

export async function jurySheet(caller: Caller, eventId: string) {
  if (!staffOnly(caller)) throw forbidden("not_visible", "The jury sheet is for staff only.");
  const [ctx, fullName] = await Promise.all([getFirestore().runTransaction((tx) => juryContext(tx, eventId), { readOnly: true }), staffFullName(caller.uid)]);
  const target = juryTargetOf(ctx.event);
  const targetIds = ctx.targets.map((t) => t.id);
  const { brief, owed, waiting, notOpenYet } = await loadJuryFollowUp(eventId, ctx.event, ctx.targets);
  // La place de chaque cible sur chaque chiffre declare (shared/juryBrief.ts), comme le lit un jure.
  const ranks = brief.metrics.map((m) => [m.key, briefMetricRanks(brief, targetIds, m.key)] as const);
  // Le staff est le jure de son nom complet, comme par le lien (`jury-{empreinte}`).
  const judgeId = namedJudgeId(fullName);
  const received = new Map<string, number>();
  for (const e of ctx.evaluations) received.set(e.targetId, (received.get(e.targetId) ?? 0) + 1);
  const mine = new Map(ctx.evaluations.filter((e) => e.evaluatorId === judgeId).map((e) => [e.targetId, e]));
  // Ou en est chaque cible, pour la boucle du staff : noter ce qui est complet, relancer le reste, revenir plus tard.
  const statusOf = (id: string): JuryTargetStatus =>
    mine.has(id) ? "scored" : !brief.submissions[id] ? "no_submission" : owed[id]?.length ? "incomplete" : waiting[id]?.length ? "waiting" : "to_score";
  const statuses = new Map(ctx.targets.map((t) => [t.id, statusOf(t.id)]));
  const summary = Object.fromEntries(JURY_TARGET_STATUSES.map((s) => [s, 0]));
  for (const s of statuses.values()) summary[s] += 1;
  return {
    object: "jury_sheet",
    event: { id: eventId, name: ctx.event.name, kind: ctx.event.kind, templateKey: ctx.event.templateKey, startDateISOString: ctx.event.startDateISOString, target },
    juryForm: { id: ctx.form.id, title: ctx.form.title, status: ctx.form.status, locked: ctx.form.status !== "open" },
    juror: fullName,
    grid: {
      criteria: ctx.grid.criteria.map(({ key, label, description, min, max, weight, required }) => ({ key, label, description, min, max, weight, required })),
      otherQuestions: ctx.grid.extras.map(({ field, label, required, scale, options }) => ({ field, label, required, scale, options })),
      comment: ctx.grid.commentQuestionId ? { max: ctx.grid.commentMax } : null,
      scoring: ctx.event.scoring?.items.map((item) => ({ label: item.label, sourceKey: item.sourceKey, maxPoints: item.maxPoints, tieBreakOnly: item.tieBreakOnly })) ?? null,
    },
    // Les chiffres declares par les cibles, pour comparer (« 5 = la meilleure equipe »).
    metrics: brief.metrics,
    source: brief.source,
    summary,
    // Pas encore ouverts : une equipe qu'ils attendent est `waiting`.
    formsNotOpenYet: notOpenYet.length ? notOpenYet : undefined,
    targets: ctx.targets.map((t) => {
      const m = mine.get(t.id);
      return {
        id: t.id,
        name: t.name,
        members: t.memberNames ?? undefined,
        status: statuses.get(t.id),
        brief: brief.submissions[t.id] ?? null,
        // A relancer : chaque formulaire du (Submission, Peer rating...), et qui (`due: "team"` : un seul suffit).
        owes: owed[t.id]?.length ? owed[t.id] : undefined,
        waitingFor: waiting[t.id]?.length ? waiting[t.id] : undefined,
        // Ses reponses, un bloc par formulaire, questions sans reponse comprises (`text: null`).
        answers: brief.blocks?.[t.id] ?? [],
        // Sa place sur chaque chiffre declare : 1 = la meilleure, parmi `of` cibles qui l'ont declare (`tied` : ex aequo).
        ranks: Object.fromEntries(ranks.flatMap(([key, byTarget]) => (byTarget.has(t.id) ? [[key, byTarget.get(t.id)]] : []))),
        scoresReceived: received.get(t.id) ?? 0,
        yourScore: m ? { scores: m.scores, comment: m.comment } : null,
      };
    }),
    next:
      target === "startup"
        ? "A pitch is judged LIVE: ask the user for their notes from the session before scoring. Then read every startup, and call `pioneers_run` `score_jury` once with all of them."
        : "Score the targets with `status: to_score` (every form filled), unless the user says otherwise; list the `incomplete` ones with `owes` so the user can remind them (`waiting`: a form they owe is not open yet). Read EVERY target you score (brief, Drive folder, proof links) before scoring any: a criterion like \"5 = the best team\" is relative. Then call `pioneers_run` `score_jury` once with them. Call this sheet again later: scoring again only adds or replaces the targets you send.",
  };
}

// ---- Ecrire : toutes les notes, par le formulaire de jury ------------------------------

const Entry = z
  .object({
    targetId: z.string().min(1).describe("A team or startup id from the jury sheet."),
    scores: z.record(z.string().min(1), z.number().int()).describe("Criterion key -> whole number on the criterion's scale (jury sheet `grid.criteria`)."),
    rationale: z
      .record(z.string().min(1), z.string().trim().min(1).max(400))
      .optional()
      .describe("Criterion key -> 1 or 2 sentences: what you checked (Drive, numbers), what is missing."),
    comment: z.string().trim().max(400).nullable().optional(),
    overallScore: z.number().int().nullable().optional(),
    decision: z.enum(EVALUATION_DECISIONS).nullable().optional(),
    wouldInvest: z.boolean().nullable().optional(),
    betLikelihood: z.number().int().nullable().optional(),
  })
  .strict();

export const ScoreJuryInput = z
  .object({
    eventId: z.string().min(1),
    evaluations: z.array(Entry).min(1).max(60).describe("One per team or startup, all at once (read the jury sheet first)."),
  })
  .strict();

export const scoreJury: Operation<typeof ScoreJuryInput> = {
  name: "score_jury",
  input: ScoreJuryInput,
  allowed: staffOnly,
  async plan(tx, caller, { eventId, evaluations: entries }) {
    const [ctx, fullName] = await Promise.all([juryContext(tx, eventId), staffFullName(caller.uid)]);
    if (ctx.form.status !== "open") throw badRequest("jury_locked", "The jury form is closed: scores are locked. Reopen it (`set_form_status`) to score.", "eventId");
    const db = getFirestore();
    const subSnaps = ctx.targets.length ? await tx.getAll(...ctx.targets.map((t) => db.doc(docPaths.submission(eventId, t.id)))) : [];
    const submissions = new Map(subSnaps.flatMap((s) => (s.exists ? [[s.id, s.data() as Submission] as const] : [])));
    const judgeId = namedJudgeId(fullName);
    const plan = juryAnswersPlan({ grid: ctx.grid, scoring: ctx.event.scoring, targets: ctx.targets, entries, evaluations: ctx.evaluations, judgeId, submissions });
    // Un envoi par contenu : une confirmation rejouee retombe sur la meme reponse.
    const submissionId = sha256(stableStringify({ eventId, entries })).slice(0, 40);
    return effectPlan(
      {
        event: ctx.event.name,
        juror: `${fullName} (you, with Claude)`,
        table: plan.rows,
        notScored: plan.notScored.length ? plan.notScored : undefined,
        note: "Sent through the jury form under YOUR name: one vote, the same as scoring by the jury link. The leaderboard follows; it counts in founder scores once the ranking is published.",
      },
      [`${COL.formResponses}/${ctx.form.id}_${submissionId}`, eventCollectionPaths.evaluations(eventId)],
      () => submitFormResponse(caller.uid, { formId: ctx.form.id, version: ctx.form.version, submissionId, answers: plan.answers }, { fullName }),
      true,
      // L'envoi d'un formulaire n'a pas de ligne d'audit : celle de l'API trace qui a note, et par ou.
      false,
    );
  },
};
