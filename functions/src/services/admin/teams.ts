import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import {
  draftTeamsWrites,
  drawGroups,
  publishedTeamsWrites,
  publishTeamsWrites,
  replaceMatchingWrites,
  seededRandom,
  teamIdFor,
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
  groupNumber,
  isDrawPublished,
  leaderIdOf,
  pairKey,
  startupFixedGroups,
  teamSizeFor,
  type GeneratorMode,
} from "../../shared/teamGenerator";
import { MATCHING_MODES, readConnections, type Attendance, type EventTeam, type Founder, type FounderConnections, type Membership, type PioneersEvent, type Startup } from "../../shared/types";
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

const GROUP_LABEL: Record<GeneratorMode, string> = { challenge: "Team", matching: "Table" };
const GROUP_WORD: Record<GeneratorMode, string> = { challenge: "team", matching: "table" };

const groupSize = z.number().int().min(GROUP_SIZE_MIN).max(GROUP_SIZE_MAX);
const pairs = z.array(z.tuple([z.string().min(1), z.string().min(1)])).max(40);

/** Tout ce qu'un tirage lit, pour un evenement du batch. */
async function drawContext(tx: Transaction, eventId: string) {
  const event = await mustRead<PioneersEvent>(tx, docPaths.event(eventId), "event", "eventId");
  const db = getFirestore();
  const [teamSnap, attendance, founders, memberships, events, startups] = await Promise.all([
    tx.get(db.collection(eventCollectionPaths.teams(eventId))),
    tx.get(db.collection(eventCollectionPaths.attendance(eventId))),
    readWhere<Founder>(tx, COL.founders, "batchId", event.batchId),
    readWhere<Membership>(tx, COL.memberships, "batchId", event.batchId),
    readWhere<PioneersEvent>(tx, COL.events, "batchId", event.batchId),
    readWhere<Startup>(tx, COL.startups, "batchId", event.batchId),
  ]);
  const teams = teamSnap.docs.map((d) => ({ ...(d.data() as EventTeam), id: d.id })).sort((a, b) => groupNumber(a.id) - groupNumber(b.id));
  // Les partis gardent leur historique mais ne sont plus proposes (SPECS §4.1).
  const eligible = founders.filter((f) => f.status !== "left" && !f.archivedDateISOString);
  const byId = new Map(founders.map((f) => [f.id, f]));
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const modeOfEvent = (id: string) => {
    const e = eventsById.get(id);
    return e ? (matchingOf(e)?.mode ?? null) : null;
  };
  return {
    event,
    matching: matchingOf(event),
    teams,
    absentIds: absentFounderIds(attendance.docs.map((d) => d.data() as Attendance)),
    eligible,
    nameOf: (id: string) => byId.get(id)?.name ?? id,
    isBatchFounder: (id: string) => byId.has(id),
    memberships,
    modeOfEvent,
    startups,
  };
}

type DrawContext = Awaited<ReturnType<typeof drawContext>>;

/** Les groupes tels que l'apercu les montre : noms, membres, leader. */
const groupsPreview = (ctx: DrawContext, groups: readonly DraftTeam[]) =>
  groups.map((g) => ({
    id: g.id ?? undefined,
    name: g.name,
    members: g.memberIds.map(ctx.nameOf),
    leader: g.leaderId ? ctx.nameOf(g.leaderId) : null,
    locked: g.locked || undefined,
  }));

function requireMatching(ctx: DrawContext) {
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
    const ctx = await drawContext(tx, eventId);
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

const savedPairs = (teams: readonly EventTeam[], key: "keepApart" | "keepTogether") =>
  (teams[0]?.drawConstraints?.[key] ?? []).map((k) => k.split("|") as [string, string]);

export const drawTeams: Operation<typeof DrawTeamsInput> = {
  name: "draw_teams",
  input: DrawTeamsInput,
  allowed: staffOnly,
  async plan(tx, _caller, input) {
    const ctx = await drawContext(tx, input.eventId);
    const matching = requireMatching(ctx);
    if (isDrawPublished(ctx.teams)) throw badRequest("published", "These groups are published: change them with `edit_teams` (no new draw).", "eventId");
    const unknown = [...(input.founderIds ?? []), ...(input.excludeFounderIds ?? []), ...(input.keepApart ?? []).flat(), ...(input.keepTogether ?? []).flat()].filter((id) => !ctx.isBatchFounder(id));
    if (unknown.length) throw badRequest("founder_not_found", `Not founders of this batch: ${[...new Set(unknown)].join(", ")}.`, "founderIds");

    const mode = matching.mode;
    const size = input.groupSize ?? matching.size.max;
    const placed = ctx.teams.flatMap((t) => t.memberIds);
    const chosen = new Set(input.founderIds ?? (placed.length > 0 ? placed : ctx.eligible.map((f) => f.id)));
    for (const id of input.excludeFounderIds ?? []) chosen.delete(id);
    const out = new Set([...ctx.absentIds, ...ctx.eligible.filter((f) => !chosen.has(f.id)).map((f) => f.id)]);
    const inFounders = ctx.eligible.filter((f) => chosen.has(f.id) && !ctx.absentIds.has(f.id));
    const participants = inFounders.map((f) => ({ id: f.id, category: f.profileCategory }));

    // Les shortlists et « Met » des participants : pour le tirage seulement.
    const db = getFirestore();
    const connectionSnaps = inFounders.length ? await tx.getAll(...inFounders.map((f) => db.doc(docPaths.founderConnections(f.id)))) : [];
    const preferences = buildPairPreferences(new Map(connectionSnaps.map((s, i) => [inFounders[i].id, readConnections((s.data() as FounderConnections | undefined) ?? null)])));

    const keepApart = input.keepApart ?? savedPairs(ctx.teams, "keepApart");
    const keepTogether = input.keepTogether ?? savedPairs(ctx.teams, "keepTogether");
    // Les groupes gardes : les verrouilles du brouillon, ou (H5) les startups en equipes fixes.
    let start = withoutMembers(toDrafts(ctx.teams), out);
    if (start.length === 0 && matching.lockedTeamsFromStartups) {
      start = withStartupTeams([], startupFixedGroups(ctx.startups.filter((s) => s.status === "active"), new Set(participants.map((p) => p.id))).groups);
    }
    const seed = input.seed ?? 1;
    const random = seededRandom(seed);
    const { groups, report } = drawGroups(
      start,
      size,
      {
        participants,
        history: buildPairHistory(ctx.memberships, ctx.modeOfEvent, ctx.event.id),
        preferences,
        rules: GENERATOR_PRESETS[mode].rules,
        keepApart,
        keepTogether,
        groupWord: GROUP_WORD[mode],
        random,
      },
      GROUP_LABEL[mode],
    );
    const withLeaders = assignLeaders(groups, buildLeaderCounts(ctx.memberships, ctx.modeOfEvent, mode, ctx.event.id), random);
    const constraints = { keepApart: keepApart.map(([a, b]) => pairKey(a, b)), keepTogether: keepTogether.map(([a, b]) => pairKey(a, b)) };
    return writePlan(
      {
        event: ctx.event.name,
        seed,
        participants: participants.length,
        absentLeftOut: [...ctx.absentIds].filter((id) => chosen.has(id)).map(ctx.nameOf),
        summary: report.summary,
        relaxed: report.relaxed,
        groups: groupsPreview(ctx, withLeaders),
        next: "Saved as a DRAFT (founders do not see it). Publish it with `publish_teams`, or draw again with another `seed`.",
      },
      draftTeamsWrites(ctx.event, withLeaders, ctx.teams, size, constraints, new Date().toISOString()),
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
    const ctx = await drawContext(tx, eventId);
    const matching = requireMatching(ctx);
    if (isDrawPublished(ctx.teams)) throw badRequest("published", "These groups are already published.", "eventId");
    const drafts = toDrafts(ctx.teams);
    const absent = drafts.flatMap((g) => g.memberIds).filter((id) => ctx.absentIds.has(id));
    if (absent.length) throw badRequest("absent_in_draft", `Marked absent but still in a group: ${absent.map(ctx.nameOf).join(", ")}. Draw again or \`edit_teams\` first.`, "eventId");
    return writePlan(
      { event: ctx.event.name, publishes: "founders see their group; each member's team history is recorded", groups: groupsPreview(ctx, drafts) },
      publishTeamsWrites(ctx.event, drafts, ctx.teams, ctx.nameOf, matching.size.max, new Date().toISOString()),
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
    const ctx = await drawContext(tx, eventId);
    const matching = requireMatching(ctx);
    const all = given.flatMap((t) => t.memberIds);
    const twice = all.filter((id, i) => all.indexOf(id) !== i);
    if (twice.length) throw badRequest("duplicate_member", `In two groups: ${[...new Set(twice)].map(ctx.nameOf).join(", ")}.`, "teams");
    const unknown = all.filter((id) => !ctx.isBatchFounder(id));
    if (unknown.length) throw badRequest("founder_not_found", `Not founders of this batch: ${unknown.join(", ")}.`, "teams");
    const savedById = new Map(ctx.teams.map((t) => [t.id, t]));
    const badId = given.find((t) => t.id && !savedById.has(t.id));
    if (badId) throw badRequest("team_not_found", `No group \`${badId.id}\` in this event.`, "teams");
    const badLeader = given.find((t) => t.leaderId && !t.memberIds.includes(t.leaderId));
    if (badLeader) throw badRequest("leader_not_member", "A leader must be a member of their group.", "teams");

    const published = isDrawPublished(ctx.teams);
    // Publie, une equipe nouvelle prend le numero libre suivant ; en brouillon, l'id suit la position.
    let lastNumber = Math.max(0, ...ctx.teams.map((t) => groupNumber(t.id)));
    const drafts: DraftTeam[] = given.map((t, i) => {
      const saved = t.id ? savedById.get(t.id) : undefined;
      const previousLeader = saved ? leaderIdOf(saved) : null;
      const number = published && !t.id ? ++lastNumber : i + 1;
      return {
        id: published ? (t.id ?? teamIdFor(eventId, number - 1)) : null,
        name: t.name ?? saved?.name ?? `${GROUP_LABEL[matching.mode]} ${number}`,
        memberIds: t.memberIds,
        leaderId: t.leaderId ?? (previousLeader && t.memberIds.includes(previousLeader) ? previousLeader : null),
        locked: published ? false : (saved?.locked ?? false),
      };
    });
    const withLeaders = assignLeaders(drafts, buildLeaderCounts(ctx.memberships, ctx.modeOfEvent, matching.mode, eventId), seededRandom(1));
    const now = new Date().toISOString();
    let writes;
    if (published) {
      const db = getFirestore();
      const [submissions, evaluations] = await Promise.all([
        tx.get(db.collection(eventCollectionPaths.submissions(eventId))),
        tx.get(db.collection(eventCollectionPaths.evaluations(eventId))),
      ]);
      const withResults = new Set([...submissions.docs.map((d) => d.id), ...evaluations.docs.map((d) => d.get("targetId") as string)]);
      writes = publishedTeamsWrites(ctx.event, withLeaders, ctx.teams, ctx.memberships, ctx.nameOf, withResults);
    } else {
      const constraints = { keepApart: ctx.teams[0]?.drawConstraints?.keepApart ?? [], keepTogether: ctx.teams[0]?.drawConstraints?.keepTogether ?? [] };
      writes = draftTeamsWrites(ctx.event, withLeaders, ctx.teams, matching.size.max, constraints, now);
    }
    const before = groupsPreview(ctx, toDrafts(ctx.teams));
    const after = groupsPreview(ctx, withLeaders);
    return writePlan(
      { event: ctx.event.name, published, before, after, note: published ? "Founders see the change; team histories follow it." : "Draft: founders do not see it." },
      writes,
      { eventId, groups: withLeaders.length },
      JSON.stringify(before) !== JSON.stringify(after),
    );
  },
};
