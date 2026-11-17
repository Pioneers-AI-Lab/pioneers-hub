import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { COL, docPaths, eventCollectionPaths } from "../shared/collections";
import { JUDGE_LIMITS, type JuryAnswer, type JuryBrief, type JurySubmission, type PublicChoice, type RespondentInput } from "../shared/callables";
import { publicShortName } from "../shared/access";
import { enumOptions, getFieldDef, isEmptyValue, parseDbField } from "../shared/fieldRegistry";
import { eventMetrics, submissionQuestions, type FieldQuestion } from "../shared/forms";
import { normalizeHttpUrl, searchKey } from "../shared/text";
import { hasSubmitted, isLateUnwaived } from "../shared/types";
import type { Evaluation, Form, Founder, JuryLink, PioneersEvent, Submission } from "../shared/types";
import { sha256 } from "../api/crypto";
import { cleanText } from "./clean";
import type { ScoredTarget } from "./events";

// ----------------------------
// services - l'identite d'un jure (formulaire de jury, lien partage)
// ----------------------------
// UN lien par evenement, `/forms/{formId}#{secret}` : qui l'a peut noter, sans
// compte (decision du 12/11). Le secret suit en fragment (jamais envoye au
// serveur web ni dans un referent) ; il vit dans `events/{id}/judges/link`,
// lisible du seul staff, qui le recopie a tout moment ou le remplace.
//
// Le jure choisit son nom dans la liste (invites de l'evenement, noms deja venus
// noter, fondateurs du batch en nom court) ou le saisit. Son id est stable par
// evenement : `founder-{founderId}`, ou `jury-{empreinte du nom normalise}` ;
// le meme nom retrouve donc ses notes. Un fondateur ne note pas sa propre
// equipe (ni sa startup) : `targetsFor`.

const db = () => getFirestore();

/** Un nom compare sans casse, accents ni espaces en trop. */
const normalizeName = (name: string) => searchKey(name).replace(/\s+/g, " ");

const founderJudgeId = (founderId: string) => `founder-${founderId}`;
const namedJudgeId = (name: string) => `jury-${sha256(normalizeName(name)).slice(0, 20)}`;

export type JudgeOption = { id: string; name: string; hint: string | null; founderId: string | null };

/** Le lien de jury de l'evenement est valide : meme refus pour tout echec (rien sur ce qui a echoue). */
export async function assertJuryKey(eventId: string | null, key: unknown): Promise<void> {
  const link = eventId ? ((await db().doc(docPaths.juryLink(eventId)).get()).data() as JuryLink | undefined) : undefined;
  if (!link || typeof key !== "string" || sha256(key) !== sha256(link.secret)) {
    throw new HttpsError("permission-denied", "This jury link is not valid any more. Ask the Pioneers team for the new one.");
  }
}

/**
 * Les noms a choisir : seuls des noms deja publics ou deja vus des jures :
 * invites (l'evenement est public), noms deja venus noter, fondateurs du batch
 * en nom court (comme les formulaires).
 */
export async function loadJury(eventId: string, event: PioneersEvent, targets: ScoredTarget[]) {
  const [foundersSnap, evaluationsSnap] = await Promise.all([
    db().collection(COL.founders).where("batchId", "==", event.batchId).select("name", "archivedDateISOString").get(),
    db().collection(eventCollectionPaths.evaluations(eventId)).select("evaluatorKind", "evaluatorId", "evaluatorName").get(),
  ]);
  const evaluations = evaluationsSnap.docs.map((d) => d.data() as Pick<Evaluation, "evaluatorKind" | "evaluatorId" | "evaluatorName">);
  const founders = foundersSnap.docs
    .map((d) => ({ id: d.id, f: d.data() as Pick<Founder, "name" | "archivedDateISOString"> }))
    .filter(({ f }) => f.archivedDateISOString === null && f.name.trim());
  const targetOf = new Map(targets.flatMap((t) => t.memberIds.map((id) => [id, t.name] as const)));

  // Les fondateurs, uniques par id ; puis les autres noms, uniques par nom : d'abord
  // ceux deja venus noter (un ancien lien par jure garde son id, donc ses notes).
  const founderOptions = founders.map(({ id, f }) => ({
    fullName: f.name,
    o: { id: founderJudgeId(id), name: publicShortName(f.name), hint: targetOf.get(id) ?? null, founderId: id } as JudgeOption,
  }));
  const options = new Map(founderOptions.map(({ o }) => [o.id, o]));
  const named = new Map<string, JudgeOption>();
  const addNamed = (id: string, name: string) => {
    const key = normalizeName(name);
    if (!options.has(id) && !named.has(key)) named.set(key, { id, name, hint: null, founderId: null });
  };
  for (const e of evaluations) if (e.evaluatorKind === "judge") addNamed(e.evaluatorId, e.evaluatorName);
  for (const g of event.guests) if (!g.founderId && g.name.trim()) addNamed(namedJudgeId(g.name), g.name.trim());
  for (const o of named.values()) options.set(o.id, o);

  // Un nom saisi retrouve son option : nom affiche, ou nom complet d'un fondateur.
  const byName = new Map<string, Set<JudgeOption>>();
  const index = (name: string, o: JudgeOption) => {
    const key = normalizeName(name);
    byName.set(key, (byName.get(key) ?? new Set<JudgeOption>()).add(o));
  };
  for (const o of options.values()) index(o.name, o);
  for (const { fullName, o } of founderOptions) index(fullName, o);
  return { options, byName };
}

export type Jury = Awaited<ReturnType<typeof loadJury>>;

/** Les noms a choisir, tels que la page les montre : invites et noms deja venus noter d'abord. */
export const judgeChoices = (jury: Jury): PublicChoice[] =>
  [...jury.options.values()].map((o) => ({ value: o.id, label: o.name, hint: o.hint }));

/**
 * Le jure de la requete. Un nom saisi qui est celui d'une personne de la liste
 * (nom affiche, ou nom complet d'un fondateur) devient cette personne : un
 * fondateur qui tape son nom ne note pas pour autant sa propre equipe.
 */
export function resolveJudge(identity: RespondentInput | null | undefined, jury: Jury): JudgeOption | null {
  if (!identity || typeof identity !== "object") return null;
  if ("judgeId" in identity && typeof identity.judgeId === "string") return jury.options.get(identity.judgeId) ?? null;
  if (!("name" in identity)) return null;
  const name = cleanText(identity.name, JUDGE_LIMITS.name, "name");
  if (!name) return null;
  const hits = jury.byName.get(normalizeName(name));
  return hits?.size === 1 ? [...hits][0] : { id: namedJudgeId(name), name, hint: null, founderId: null };
}

/** Ce que ce jure peut noter : tout, sauf l'equipe (ou la startup) dont il est membre. */
export const targetsFor = (targets: ScoredTarget[], founderId: string | null) =>
  founderId === null ? targets : targets.filter((t) => !t.memberIds.includes(founderId));

// ---- Ce que le jure lit avant de noter (SPECS §2.0) -----------------------------
// La Submission est une information libre, lue par le jury ; c'est la grille
// (0 a 5 par critere) qui fait la note. Le jure lit donc, pour chaque equipe
// qu'il note, ce qu'elle a rendu, et les chiffres declares de toutes ces equipes
// (« 5 = la meilleure equipe »). Seulement les cibles de CE jure : un fondateur
// qui note ne recoit pas la Submission de sa propre equipe.

/** Le dossier Drive est rendu a part (lien mis en avant) ; les chiffres, compares entre equipes. */
const DRIVE_FIELD = "submission.driveFolderUrl";

/**
 * Comment lire une question de la Submission : les liens a part, une valeur fixe
 * par son libelle (les champs de la Submission n'ont pas de liste fermee) ; `read`
 * rend `null` sans reponse.
 */
function answerReader(q: FieldQuestion): { field: string; read: (value: unknown) => JuryAnswer | null } {
  const spec = getFieldDef(q.dbField).value;
  const isLink = spec.kind === "url" || spec.kind === "files";
  const options = isLink ? null : enumOptions(spec, new Map());
  return {
    field: parseDbField(q.dbField).field,
    read: (value) => {
      const values = (Array.isArray(value) ? value : [value]).filter((v) => !isEmptyValue(v));
      if (values.length === 0) return null;
      if (isLink) return { label: q.label, text: null, urls: values.map(String) };
      const text = values.map((v) => options?.find((o) => o.value === v)?.label ?? String(v));
      return { label: q.label, text: text.join(", "), urls: [] };
    },
  };
}

/**
 * Un pitch (lot 5) : le Pitch deck de chaque startup notee, lu dans sa fiche (`startup.*`,
 * `startupProfile.*`), a la place d'une Submission. Expose a qui a le lien du jury, comme une Submission.
 */
async function loadPitchDecks(questions: FieldQuestion[], targetIds: string[]): Promise<Record<string, JurySubmission>> {
  const readers = questions.map((q) => ({ doc: parseDbField(q.dbField).doc, ...answerReader(q) }));
  const snaps = await db().getAll(...targetIds.flatMap((id) => [db().doc(docPaths.startup(id)), db().doc(docPaths.startupProfile(id))]));
  const out: Record<string, JurySubmission> = {};
  targetIds.forEach((id, i) => {
    const [startup, profile] = [snaps[2 * i], snaps[2 * i + 1]];
    const answers = readers.flatMap((r) => r.read((r.doc === "startup" ? startup : profile).get(r.field)) ?? []);
    if (answers.length) out[id] = { driveFolderUrl: null, late: false, answers, metrics: {} };
  });
  return out;
}

/**
 * Ce que le jure lit sur ses cibles (`targetIds`, au moins une) : les Submissions des equipes et les
 * metriques qu'elles declarent ; des startups notees (un pitch) avec un Pitch deck, leurs Pitch decks.
 */
export async function loadJuryBrief(eventId: string, targetIds: string[], target: "team" | "startup"): Promise<JuryBrief> {
  const formsSnap = await db().collection(COL.forms).where("eventId", "==", eventId).select("questions", "archivedDateISOString").get();
  const forms = formsSnap.docs.map((d) => d.data() as Pick<Form, "questions" | "archivedDateISOString">);
  const deckQuestions = target === "startup" ? submissionQuestions(forms, ["startup", "startupProfile"]) : [];
  if (deckQuestions.length > 0) return { source: "pitch_deck", metrics: [], submissions: await loadPitchDecks(deckQuestions, targetIds) };
  const submissionSnaps = await db().getAll(...targetIds.map((id) => db().doc(docPaths.submission(eventId, id))));
  const metrics = eventMetrics(forms);
  // Le champ et le format de chaque question, une fois pour toutes les equipes.
  const readers = submissionQuestions(forms)
    .filter((q) => q.dbField !== DRIVE_FIELD)
    .map(answerReader);
  const submissions: Record<string, JurySubmission> = {};
  for (const snap of submissionSnaps) {
    const s = snap.data() as Submission | undefined;
    if (!hasSubmitted(s) || !s) continue;
    const declared = metrics.flatMap((m) => (typeof s.metrics?.[m.key] === "number" ? [[m.key, s.metrics[m.key]] as const] : []));
    const answers = readers.flatMap((r) => r.read(snap.get(r.field)) ?? []);
    const driveFolderUrl = s.driveFolderUrl ? normalizeHttpUrl(s.driveFolderUrl) : null;
    submissions[snap.id] = {
      driveFolderUrl,
      late: isLateUnwaived(s),
      answers,
      metrics: Object.fromEntries(declared),
    };
  }
  // Une metrique que personne n'a declaree ne compare rien.
  return { source: "submission", metrics: metrics.filter((m) => Object.values(submissions).some((s) => m.key in s.metrics)), submissions };
}
