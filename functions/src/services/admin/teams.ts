import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import {
  constraintsOf,
  draftTeamsWrites,
  drawGroups,
  nextTeamNumber,
  publishedTeamsWrites,
  publishTeamsWrites,
  replaceMatchingWrites,
  savedPairs,
  savedShortNames,
  seededRandom,
  teamIdFor,
  teamIdsWithResults,
  toDrafts,
  withoutMembers,
  withStartupTeams,
  type DraftTeam,
} from "../../shared/admin/teams";
import { absentFounderIds } from "../../shared/attendance";
import { COL, docPaths, eventCollectionPaths } from "../../shared/collections";
import { matchingOf } from "../../shared/events";
import {
  assignLeaders,
  buildLeaderCounts,
  buildPairHistory,
  buildPairPreferences,
  GENERATOR_PRESETS,
  GROUP_SIZE_MAX,
  GROUP_SIZE_MIN,
  GROUP_WORDS,
  groupNumber,
  isDrawPublished,
  leaderIdOf,
  startupFixedGroups,
  teamSizeFor,
} from "../../shared/teamGenerator";
import { isPickable, MATCHING_MODES, readConnections, type Attendance, type EventTeam, type Founder, type FounderConnections, type Membership, type PioneersEvent, type Startup } from "../../shared/types";
import { badRequest } from "../../api/errors";
import type { Operation } from "../operations";
import { mustRead, readWhere, staffOnly, writePlan } from "./writes";

// ----------------------------
// services/admin - le matching d'un evenement : regler, tirer, publier, retoucher
// ----------------------------
// Les gestes d'Admin > Events > Matching (TeamGenerator), par shared/admin/teams.ts
// comme a l'ecran. Le tirage est REJOUABLE : un `seed` donne toujours le meme
// resultat (l'apercu montre ce que la confirmation ecrira) ; un autre `seed`, un
// autre tirage. Comme a l'ecran, il lit les shortlists et « Met » des fondateurs
// (`private/connections`) pour les reunir ou les separer : elles servent au
// tirage, jamais rendues (l'apercu n'en donne que des comptes).

const groupSize = z.number().int().min(GROUP_SIZE_MIN).max(GROUP_SIZE_MAX);
const pairs = z.array(z.tuple([z.string().min(1), z.string().min(1)])).max(40);

type Tx = Transaction;

/** Ce que lit chaque geste : l'evenement et ses groupes (le reste a la demande, pour ne verrouiller que le necessaire). */
async function eventTeams(tx: Tx, eventId: string) {
  const db = getFirestore();
  const [event, teamSnap] = await Promise.all([
    mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId"),
    tx.get(db.collection(eventCollectionPaths.teams(eventId))),
  ]);
  const teams = teamSnap.docs.map((d) => ({ ...(d.data() as EventTeam), id: d.id })).sort((a, b) => groupNumber(a.id) - groupNumber(b.id));
  return { event, matching: matchingOf(event), teams };
}

type EventTeams = Awaited<ReturnType<typeof eventTeams>>;

const absentOf = async (tx: Tx, eventId: string) =>
  absentFounderIds((await tx.get(getFirestore().collection(eventCollectionPaths.attendance(eventId)))).docs.map((d) => d.data() as Attendance));

/** Les fondateurs donnes, verifies : du batch de l'evenement, sinon refus. */
async function foundersOf(tx: Tx, batchId: string, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const snaps = unique.length ? await tx.getAll(...unique.map((id) => getFirestore().doc(docPaths.founder(id)))) : [];
  const found = snaps.flatMap((s) => (s.exists && (s.data() as Founder).batchId === batchId ? [{ ...(s.data() as Founder), id: s.id }] : []));
  const missing = unique.filter((id) => !found.some((f) => f.id === id));
  if (missing.length) throw badRequest("founder_not_found", `Not founders of this batch: ${missing.join(", ")}.`, "founderIds");
  return new Map(found.map((f) => [f.id, f]));
}

/** L'historique du batch : appartenances aux groupes et mode du matching de chaque evenement (paires, leaders). */
async function historyOf(tx: Tx, batchId: string) {
  const [memberships, events] = await Promise.all([
    readWhere<Membership>(tx, COL.memberships, "batchId", batchId),
    readWhere<PioneersEvent>(tx, COL.events, "batchId", batchId),
  ]);
  const modeOf = new Map(events.map((e) => [e.id, matchingOf(e)?.mode ?? null]));
  return { memberships, modeOfEvent: (id: string) => modeOf.get(id) ?? null };
}

/** Les groupes tels que l'apercu les montre : noms, membres, leader. */
const groupsPreview = (nameOf: (id: string) => string, groups: readonly DraftTeam[]) =>
  groups.map((g) => ({
    id: g.id ?? undefined,
    name: g.name,
    members: g.memberIds.map(nameOf),
    leader: g.leaderId ? nameOf(g.leaderId) : null,
    locked: g.locked || undefined,
  }));

function requireMatching(ctx: EventTeams) {
  if (!ctx.matching) throw badRequest("no_matching", "This event has no matching: give it one first (`set_matching`).", "eventId");
  return ctx.matching;
}

// ---- Le type de matching ----------------------------------------------------------

export const SetMatchingInput = z
  .object({
    eventId: z.string().min(1),
    mode: z.enum(MATCHING_MODES).nullable().describe("`challenge`: work teams with a leader; `matching`: tables to meet new people; null removes it."),
    size: groupSize.optional().describe("Target group size. Default: the mode's."),
  })
  .strict();

export const setMatching: Operation<typeof SetMatchingInput> = {
  name: "set_matching",
  input: SetMatchingInput,
  allowed: staffOnly,
  async plan(tx, _caller, { eventId, mode, size }) {
    const ctx = await eventTeams(tx, eventId);
    const matching = mode ? { ...(ctx.event.matching ?? {}), mode, size: teamSizeFor(size ?? GENERATOR_PRESETS[mode].defaultSize) } : null;
    const writes = replaceMatchingWrites(eventId, matching, ctx.teams, new Date().toISOString());
    return writePlan(
      { event: ctx.event.name, from: ctx.matching, to: matching, removesDraftTeams: ctx.teams.length || undefined },
      writes,
      { eventId },
      JSON.stringify(ctx.matching) !== JSON.stringify(matching),
    );
  },
};

// ---- Tirer (brouillon) ----------------------------------------------------------------

export const DrawTeamsInput = z
  .object({
    eventId: z.string().min(1),
    groupSize: groupSize.optional().describe("Default: the matching's size."),
    founderIds: z.array(z.string().min(1)).max(200).optional().describe("Who is drawn. Default: those of the saved draft, else every active founder of the batch. Absent founders are always left out."),
    excludeFounderIds: z.array(z.string().min(1)).max(200).optional().describe("Leave these founders out of the draw."),
    keepApart: pairs.optional().describe("Pairs of founder ids never in the same group. Default: the saved draft's."),
    keepTogether: pairs.optional().describe("Pairs always together (co-founders). Default: the saved draft's."),
    seed: z.number().int().min(0).max(2 ** 31).optional().describe("Same seed = same draw. Another seed for another draw. Default 1."),
  })
  .strict();


export const drawTeams: Operation<typeof DrawTeamsInput> = {
  name: "draw_teams",
  input: DrawTeamsInput,
  allowed: staffOnly,
  async plan(tx, _caller, input) {
    const ctx = await eventTeams(tx, input.eventId);
    const matching = requireMatching(ctx);
    if (isDrawPublished(ctx.teams)) throw badRequest("published", "These groups are published: change them with `edit_teams` (no new draw).", "eventId");
    const { batchId } = ctx.event;
    const [founders, absentIds, history] = await Promise.all([readWhere<Founder>(tx, COL.founders, "batchId", batchId), absentOf(tx, ctx.event.id), historyOf(tx, batchId)]);
    const byId = new Map(founders.map((f) => [f.id, f]));
    const nameOf = (id: string) => byId.get(id)?.name ?? id;
    const unknown = [...(input.founderIds ?? []), ...(input.excludeFounderIds ?? []), ...(input.keepApart ?? []).flat(), ...(input.keepTogether ?? []).flat()].filter((id) => !byId.has(id));
    if (unknown.length) throw badRequest("founder_not_found", `Not founders of this batch: ${[...new Set(unknown)].join(", ")}.`, "founderIds");

    // Comme TeamGenerator : les choisissables ; ceux du brouillon, sinon tout le batch ; jamais un absent.
    const mode = matching.mode;
    const size = input.groupSize ?? matching.size.max;
    const eligible = founders.filter((f) => isPickable(f, batchId));
    const placed = ctx.teams.flatMap((t) => t.memberIds);
    const chosen = new Set(input.founderIds ?? (placed.length > 0 ? placed : eligible.map((f) => f.id)));
    for (const id of input.excludeFounderIds ?? []) chosen.delete(id);
    const inFounders = eligible.filter((f) => chosen.has(f.id) && !absentIds.has(f.id));
    const participants = inFounders.map((f) => ({ id: f.id, category: f.profileCategory }));
    const out = new Set([...absentIds, ...eligible.filter((f) => !chosen.has(f.id)).map((f) => f.id)]);

    // Les shortlists et « Met » des participants : pour le tirage seulement.
    const db = getFirestore();
    const connectionSnaps = inFounders.length ? await tx.getAll(...inFounders.map((f) => db.doc(docPaths.founderConnections(f.id)))) : [];
    const preferences = buildPairPreferences(new Map(connectionSnaps.map((snap, i) => [inFounders[i].id, readConnections((snap.data() as FounderConnections | undefined) ?? null)])));

    const keepApart = input.keepApart ?? savedPairs(ctx.teams, "keepApart");
    const keepTogether = input.keepTogether ?? savedPairs(ctx.teams, "keepTogether");
    // Les groupes gardes : les verrouilles du brouillon, ou (H5) les startups en equipes fixes, lues seulement alors.
    let start = withoutMembers(toDrafts(ctx.teams), out);
    if (start.length === 0 && matching.lockedTeamsFromStartups) {
      const startups = await readWhere<Startup>(tx, COL.startups, "batchId", batchId);
      start = withStartupTeams([], startupFixedGroups(startups.filter((st) => st.status === "active"), new Set(participants.map((p) => p.id))).groups);
    }
    const seed = input.seed ?? 1;
    const random = seededRandom(seed);
    const { groups, report } = drawGroups(
      start,
      size,
      { participants, history: buildPairHistory(history.memberships, history.modeOfEvent, ctx.event.id), preferences, rules: GENERATOR_PRESETS[mode].rules, keepApart, keepTogether, groupWord: GROUP_WORDS[mode].groupWord, random },
      GROUP_WORDS[mode].groupLabel,
    );
    const withLeaders = assignLeaders(groups, buildLeaderCounts(history.memberships, history.modeOfEvent, mode, ctx.event.id), random);
    return writePlan(
      {
        event: ctx.event.name,
        seed,
        participants: participants.length,
        absentLeftOut: [...absentIds].filter((id) => chosen.has(id)).map(nameOf),
        summary: report.summary,
        relaxed: report.relaxed,
        groups: groupsPreview(nameOf, withLeaders),
        next: "Saved as a DRAFT (founders do not see it). Publish it with `publish_teams`, or draw again with another `seed`.",
      },
      draftTeamsWrites(ctx.event, withLeaders, ctx.teams, size, constraintsOf(keepApart, keepTogether), new Date().toISOString()),
      { eventId: ctx.event.id, groups: withLeaders.length },
    );
  },
};

// ---- Publier ------------------------------------------------------------------------

export const PublishTeamsInput = z.object({ eventId: z.string().min(1) }).strict();

export const publishTeams: Operation<typeof PublishTeamsInput> = {
  name: "publish_teams",
  input: PublishTeamsInput,
  allowed: staffOnly,
  async plan(tx, _caller, { eventId }) {
    const ctx = await eventTeams(tx, eventId);
    const matching = requireMatching(ctx);
    if (isDrawPublished(ctx.teams)) throw badRequest("published", "These groups are already published.", "eventId");
    const drafts = toDrafts(ctx.teams);
    const members = drafts.flatMap((g) => g.memberIds);
    const [byId, absentIds] = await Promise.all([foundersOf(tx, ctx.event.batchId, members), absentOf(tx, eventId)]);
    const nameOf = (id: string) => byId.get(id)?.name ?? id;
    const absent = members.filter((id) => absentIds.has(id));
    if (absent.length) throw badRequest("absent_in_draft", `Marked absent but still in a group: ${absent.map(nameOf).join(", ")}. Draw again or \`edit_teams\` first.`, "eventId");
    return writePlan(
      { event: ctx.event.name, publishes: "founders see their group; each member's team history is recorded", groups: groupsPreview(nameOf, drafts) },
      publishTeamsWrites(ctx.event, drafts, ctx.teams, nameOf, matching.size.max, new Date().toISOString()),
      { eventId, groups: drafts.length },
    );
  },
};

// ---- Retoucher ----------------------------------------------------------------------

export const EditTeamsInput = z
  .object({
    eventId: z.string().min(1),
    teams: z
      .array(
        z
          .object({
            id: z.string().min(1).optional().describe("A saved group's id (keeps it). Omit for a new group."),
            name: z.string().trim().min(1).max(80).optional(),
            memberIds: z.array(z.string().min(1)).min(1).max(GROUP_SIZE_MAX * 2),
            leaderId: z.string().min(1).optional().describe("A member. Default: the current leader if still in, else drawn among those who led least."),
          })
          .strict(),
      )
      .min(1)
      .max(60)
      .describe("The FULL list of groups after the change (swap, move, late arrival, new leader). A saved group left out is removed (refused if it has results)."),
  })
  .strict();

export const editTeams: Operation<typeof EditTeamsInput> = {
  name: "edit_teams",
  input: EditTeamsInput,
  allowed: staffOnly,
  async plan(tx, _caller, { eventId, teams: given }) {
    const ctx = await eventTeams(tx, eventId);
    const matching = requireMatching(ctx);
    const all = given.flatMap((t) => t.memberIds);
    const savedById = new Map(ctx.teams.map((t) => [t.id, t]));
    const [byId, history] = await Promise.all([foundersOf(tx, ctx.event.batchId, all), historyOf(tx, ctx.event.batchId)]);
    // Un membre retire n'est plus dans `all` : son nom court enregistre sur le groupe (apercu « avant »).
    const savedNames = savedShortNames(ctx.teams);
    const nameOf = (id: string) => byId.get(id)?.name ?? (savedNames.get(id) || id);
    const twice = all.filter((id, i) => all.indexOf(id) !== i);
    if (twice.length) throw badRequest("duplicate_member", `In two groups: ${[...new Set(twice)].map(nameOf).join(", ")}.`, "teams");
    const badId = given.find((t) => t.id && !savedById.has(t.id));
    if (badId) throw badRequest("team_not_found", `No group \`${badId.id}\` in this event.`, "teams");
    const badLeader = given.find((t) => t.leaderId && !t.memberIds.includes(t.leaderId));
    if (badLeader) throw badRequest("leader_not_member", "A leader must be a member of their group.", "teams");

    // Publie, un groupe nouveau prend le numero libre suivant (`nextTeamNumber`, comme l'ecran) ; en brouillon, l'id suit la position.
    const published = isDrawPublished(ctx.teams);
    const drafts: DraftTeam[] = [];
    for (const [i, t] of given.entries()) {
      const saved = t.id ? savedById.get(t.id) : undefined;
      const previousLeader = saved ? leaderIdOf(saved) : null;
      const number = published && !t.id ? nextTeamNumber(drafts, ctx.teams) : i + 1;
      drafts.push({
        id: published ? (t.id ?? teamIdFor(eventId, number - 1)) : null,
        name: t.name ?? saved?.name ?? `${GROUP_WORDS[matching.mode].groupLabel} ${number}`,
        memberIds: t.memberIds,
        leaderId: t.leaderId ?? (previousLeader && t.memberIds.includes(previousLeader) ? previousLeader : null),
        locked: published ? false : (saved?.locked ?? false),
      });
    }
    const withLeaders = assignLeaders(drafts, buildLeaderCounts(history.memberships, history.modeOfEvent, matching.mode, eventId), seededRandom(1));
    let writes;
    if (published) {
      // Les resultats ne se lisent que pour un groupe retire : une retouche courante (echange, deplacement) n'en retire aucun.
      const dropped = ctx.teams.filter((t) => !withLeaders.some((g) => g.id === t.id)).map((t) => t.id);
      let withResults = new Set<string>();
      if (dropped.length) {
        const db = getFirestore();
        const [submissions, evaluations] = await Promise.all([
          tx.getAll(...dropped.map((id) => db.doc(docPaths.submission(eventId, id)))),
          tx.get(db.collection(eventCollectionPaths.evaluations(eventId)).where("targetId", "in", dropped.slice(0, 30))),
        ]);
        withResults = teamIdsWithResults(submissions.filter((d) => d.exists).map((d) => d.id), evaluations.docs.map((d) => ({ targetId: d.get("targetId") as string })));
      }
      writes = publishedTeamsWrites(ctx.event, withLeaders, ctx.teams, history.memberships, nameOf, withResults);
    } else {
      writes = draftTeamsWrites(ctx.event, withLeaders, ctx.teams, matching.size.max, ctx.teams[0]?.drawConstraints ?? constraintsOf([], []), new Date().toISOString());
    }
    const before = groupsPreview(nameOf, toDrafts(ctx.teams));
    const after = groupsPreview(nameOf, withLeaders);
    return writePlan(
      { event: ctx.event.name, published, before, after, note: published ? "Founders see the change; team histories follow it." : "Draft: founders do not see it." },
      writes,
      { eventId, groups: withLeaders.length },
      JSON.stringify(before) !== JSON.stringify(after),
    );
  },
};
