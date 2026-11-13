import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { COL, docPaths, eventCollectionPaths } from "../shared/collections";
import { JUDGE_LIMITS, type PublicChoice, type RespondentInput } from "../shared/callables";
import { publicShortName } from "../shared/access";
import { searchKey } from "../shared/text";
import type { Evaluation, Founder, JuryLink, PioneersEvent } from "../shared/types";
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
