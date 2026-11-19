import { docPaths } from "../collections";
import { deleteWrite, mergeWrite, RuleError, setWrite, type DocWrite } from "../docWrites";
import { isAppPath, normalizeHttpUrl, slugify } from "../text";
import { BATCH_MILESTONE_KEYS, type AttendanceStatus, type Batch, type BatchResource, type BatchResources, type BatchTask, type ClosedList, type Founder, type Person, type Program, type TaskCheck } from "../types";

// ----------------------------
// Admin : programmes, batchs, listes fermees, taches du To do, presence, rattachements
// ----------------------------
// Les gestes de l'Admin en logique pure (shared/docWrites.ts) : le front
// (lib/batchAdmin.ts, tasksAdmin.ts, attendanceAdmin.ts, accounts.ts) et l'API
// (services/admin/*.ts) ecrivent les memes documents. Rien n'est supprime : on
// archive (seul un rattachement `batchMemberships`, un droit d'acces, s'efface).

// ---- Programmes et batchs ------------------------------------------------------
// Les ids sont des slugs lisibles (`accelerator`, `fall-2026`) : ils
// apparaissent dans les URL et dans les ids deterministes.

export { slugify };

const MILESTONE_LABELS: Record<(typeof BATCH_MILESTONE_KEYS)[number], string> = {
  kickoff: "Kick-off",
  selection_day: "Selection Day",
  pre_ic: "Pre-IC",
  ic: "Investment Committee",
  demo_day: "Demo Day",
};

type NoStamps<T> = Omit<T, "createdDateISOString" | "updatedDateISOString">;

export const newProgram = (input: { name: string; description: string | null }): NoStamps<Program> => ({
  name: input.name,
  description: input.description,
  archivedDateISOString: null,
});

export type NewBatchInput = { programId: string; name: string; startDayString: string; endDayString: string | null };

/** Un batch neuf, a venir, avec ses jalons (le kick-off a sa date de debut). */
export const newBatch = (input: NewBatchInput): NoStamps<Batch> => ({
  programId: input.programId,
  name: input.name,
  startDayString: input.startDayString,
  endDayString: input.endDayString,
  status: "upcoming",
  milestones: BATCH_MILESTONE_KEYS.map((key) => ({ key, label: MILESTONE_LABELS[key], dayString: key === "kickoff" ? input.startDayString : null })),
  settings: { leaderboardVisibility: "visible", slackChannelId: null, slackTeamId: null },
  archivedDateISOString: null,
});

/** Les listes fermees qu'un import (ou le staff) complete. */
export const EXTENSIBLE_LISTS = ["hardSkills", "industries", "positionFit"] as const;
export type ExtensibleList = (typeof EXTENSIBLE_LISTS)[number];

/**
 * Ajoute a une liste fermee les valeurs qu'elle n'a pas encore (casse ignoree).
 * Rend les valeurs ajoutees et l'ecriture, `null` si rien n'est nouveau.
 */
export function listValuesWrite(key: ExtensibleList, current: ClosedList | undefined, values: readonly string[], now: string) {
  const known = new Set((current?.items ?? []).map((i) => i.value.toLowerCase()));
  const fresh = [...new Set(values.map((v) => v.trim()).filter(Boolean))].filter((v) => !known.has(v.toLowerCase()));
  if (fresh.length === 0) return { added: [], write: null };
  const write = mergeWrite(docPaths.list(key), {
    key,
    label: current?.label ?? key,
    items: [...(current?.items ?? []), ...fresh.map((v) => ({ value: v, label: v, group: null, archived: false }))],
    updatedDateISOString: now,
  });
  return { added: fresh, write };
}

// ---- Liens utiles (Admin > Batch settings, accueil du batch) -----------------------

export const BATCH_RESOURCE_LIMITS = { items: 50, label: 80, description: 500 } as const;

/**
 * La ressource saisie, nettoyee (lien complete comme celui d'une tache, description
 * vide = `null`), ou ce qui ne va pas : l'ecran l'affiche sous le champ, l'API le refuse.
 */
export function parseBatchResource(r: BatchResource): { resource: BatchResource } | { problem: string; field: "label" | "url" } {
  const label = r.label.trim();
  if (!label) return { problem: "A label is required.", field: "label" };
  const url = parseTaskLink(r.url);
  if (!url) return { problem: "A web address, or a path of the app starting with /.", field: "url" };
  return { resource: { label, description: r.description?.trim() || null, url } };
}

/** La liste nettoyee ; leve sur la premiere ressource fautive (API ; l'ecran montre l'erreur sous le champ). */
export const cleanBatchResources = (items: readonly BatchResource[]): BatchResource[] =>
  items.map((r, i) => {
    const parsed = parseBatchResource(r);
    if ("problem" in parsed) throw new RuleError("invalid_resource", `Resource ${i + 1}: ${parsed.problem}`, `resources.${i}.${parsed.field}`);
    return parsed.resource;
  });

/** La liste entiere, deja nettoyee (`parseBatchResource`), remplacee : l'ordre est celui de l'accueil. */
export function batchResourcesWrite(batch: { id: string; programId: string }, items: BatchResource[], now: string): DocWrite {
  const doc: BatchResources = { programId: batch.programId, batchId: batch.id, items, updatedDateISOString: now };
  return setWrite(docPaths.batchResources(batch.id), doc);
}

// ---- Taches du To do (Admin > Tasks) ---------------------------------------------
// Retirer une tache l'archive ; les coches des fondateurs restent.

/** Ce que le staff regle sur une tache. */
export type TaskDraft = Pick<BatchTask, "title" | "description" | "linkUrl"> & {
  opensDateISOString: string | null;
  deadlineDateISOString: string | null;
  check: TaskCheck | null;
};

/** Les reglages d'une tache, champs absents (taches d'avant le 18/11) a `null`. */
export const taskDraftOf = (task: BatchTask): TaskDraft => ({
  title: task.title,
  description: task.description,
  linkUrl: task.linkUrl,
  opensDateISOString: task.opensDateISOString ?? null,
  deadlineDateISOString: task.deadlineDateISOString ?? null,
  check: task.check ?? null,
});

/** Une echeance avant l'ouverture se refuse (Admin > Tasks, `create_task`, `update_task`). */
export const taskScheduleProblem = (t: Pick<TaskDraft, "opensDateISOString" | "deadlineDateISOString">): string | null =>
  t.opensDateISOString && t.deadlineDateISOString && t.deadlineDateISOString <= t.opensDateISOString ? "The deadline must come after the opening." : null;


/**
 * Le lien saisi : un chemin de l'app (`/programs/…`) tel quel, sinon une adresse
 * web (protocole complete, `shared/text.ts#normalizeHttpUrl`) ; vide = `null`.
 * `undefined` : ni l'un ni l'autre (a corriger).
 */
export function parseTaskLink(value: string): string | null | undefined {
  const text = value.trim();
  if (!text) return null;
  if (isAppPath(text)) return text;
  return normalizeHttpUrl(text) ?? undefined;
}

/** Une tache neuve, en fin de liste (`tasks` : celles du batch). */
export const newTask = (batch: { id: string; programId: string }, draft: TaskDraft, tasks: readonly Pick<BatchTask, "order">[]): NoStamps<BatchTask> => ({
  ...draft,
  programId: batch.programId,
  batchId: batch.id,
  order: Math.max(0, ...tasks.map((t) => t.order)) + 1,
  archivedDateISOString: null,
});

/**
 * Renumerote 1..n la liste dans son nouvel ordre : seules les taches dont le
 * rang change sont ecrites (deux rangs egaux ne bloquent donc jamais).
 */
export const taskOrderWrites = (ordered: readonly { id: string; order: number }[], now: string): DocWrite[] =>
  ordered.flatMap((t, i) => (t.order === i + 1 ? [] : [mergeWrite(docPaths.batchTask(t.id), { order: i + 1, updatedDateISOString: now })]));

/** La liste avec la tache `from` deplacee au rang `to` (0 = en tete). */
export function moveInList<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

// ---- Presence (Admin > Events > Attendance) -------------------------------------
// La regle (present par defaut, premier geste) : shared/attendance.ts.

/**
 * Donne a chacun son statut, et enregistre presents les attendus sans document
 * (`eventRoster().unmarkedIds`) : la presence est alors relevee pour tous.
 */
export function attendanceWrites(
  eventId: string,
  marks: readonly { founderId: string; status: AttendanceStatus }[],
  unmarkedIds: readonly string[],
  markedByUid: string,
  now: string,
): DocWrite[] {
  const status = new Map<string, AttendanceStatus>(unmarkedIds.map((id) => [id, "present"]));
  for (const m of marks) status.set(m.founderId, m.status);
  return [...status].map(([founderId, s]) => setWrite(docPaths.attendance(eventId, founderId), { founderId, status: s, markedByUid, markedDateISOString: now }));
}

// ---- Rattachement d'un compte a un profil (Admin > Founder profiles) -----------

type LinkFounder = Pick<Founder, "programId" | "batchId">;

/** Le profil et le droit d'acces au batch (`batchMemberships`). */
export const founderLinkWrites = (founder: LinkFounder, founderId: string, uid: string, now: string): DocWrite[] => [
  mergeWrite(docPaths.founder(founderId), { uid, claimedDateISOString: now, updatedDateISOString: now }),
  setWrite(docPaths.membership(founder.batchId, uid), { programId: founder.programId, batchId: founder.batchId, uid, founderId, createdDateISOString: now }),
];

/**
 * Le staff rattache un profil a un compte. Un profil par batch et par compte.
 * Si la personne n'a pas encore de compte, elle est rattachee aussi (l'email
 * du compte rejoint ses `altEmails`) : le fondateur peut alors modifier
 * WhatsApp et LinkedIn. Leve si le profil est deja pris ou si le compte a deja
 * un profil dans ce batch.
 */
export function linkFounderWrites(input: {
  founder: (LinkFounder & Pick<Founder, "uid" | "personId">) | undefined;
  founderId: string;
  account: { uid: string; email: string | null };
  hasMembership: boolean;
  person: { uid: string | null; email: string | null; altEmails: readonly string[] } | undefined;
  userPersonId: string | null | undefined;
  now: string;
}): DocWrite[] {
  const { founder, founderId, account, person, now } = input;
  if (!founder) throw new RuleError("founder_not_found", "This profile no longer exists.", "founderId");
  if (founder.uid !== null) throw new RuleError("already_linked", "This profile is already linked to an account.", "founderId");
  if (input.hasMembership) throw new RuleError("account_has_profile", "This account is already linked to a profile in this batch.", "uid");
  const writes = founderLinkWrites(founder, founderId, account.uid, now);
  if (person && person.uid === null) {
    const email = account.email?.toLowerCase() ?? null;
    const altEmails = email && email !== person.email && !person.altEmails.includes(email) ? [...person.altEmails, email] : null;
    writes.push(mergeWrite(docPaths.person(founder.personId), { uid: account.uid, ...(altEmails ? { altEmails } : {}), updatedDateISOString: now }));
    if (input.userPersonId === null) writes.push(mergeWrite(docPaths.user(account.uid), { personId: founder.personId }));
  }
  return writes;
}

/**
 * Delie un profil de son compte : le compte perd l'acces au batch (le lien
 * `batchMemberships` est SUPPRIME : un droit d'acces, pas une donnee) ; le
 * profil reste intact et redevient reclamable. Si le compte ne tient plus rien
 * de cette personne (aucun autre profil, ni fiche mentor ou investor), la
 * personne et le compte sont detaches aussi : sinon le rattachement automatique
 * par email d'un autre compte ignorerait cette personne, vue comme deja prise.
 * `sameAccountFounderIds` : les profils de cette personne tenus par ce compte.
 */
export function unlinkFounderWrites(input: {
  founder: { id: string; batchId: string; personId: string; uid: string };
  sameAccountFounderIds: readonly string[];
  person: Pick<Person, "uid" | "mentorId" | "investorId"> | undefined;
  userPersonId: string | null | undefined;
  now: string;
}): { writes: DocWrite[]; keepsPerson: boolean } {
  const { founder, person, now } = input;
  const keepsPerson = input.sameAccountFounderIds.some((id) => id !== founder.id) || Boolean(person?.mentorId || person?.investorId);
  const writes = [
    mergeWrite(docPaths.founder(founder.id), { uid: null, claimedDateISOString: null, updatedDateISOString: now }),
    deleteWrite(docPaths.membership(founder.batchId, founder.uid)),
  ];
  if (!keepsPerson) {
    if (person?.uid === founder.uid) writes.push(mergeWrite(docPaths.person(founder.personId), { uid: null, updatedDateISOString: now }));
    if (input.userPersonId === founder.personId) writes.push(mergeWrite(docPaths.user(founder.uid), { personId: null }));
  }
  return { writes, keepsPerson };
}
