import {
  draftTeamsWrites,
  publicNamesWrites,
  publishedTeamsWrites,
  publishTeamsWrites,
  replaceMatchingWrites,
  type DraftTeam,
  type FullNameOf,
} from "@shared/admin/teams";
import type { DrawConstraints, EventMatching, EventTeam, Membership, PioneersEvent, WithId } from "@shared/types";
import { commitWrites } from "@/lib/firestore/write";

// ----------------------------
// Equipes d'un challenge, groupes de lunch roulette (staff, SPECS §4.1)
// ----------------------------
// Le cycle d'un tirage (brouillon, publication, retouche) : shared/admin/teams.ts,
// la regle que suit aussi l'API (`draw_teams`, `publish_teams`, `edit_teams`,
// `set_matching`). Ici, seulement l'execution en lot.

const now = () => new Date().toISOString();

export const replaceMatching = (event: WithId<PioneersEvent>, matching: EventMatching | null, existing: WithId<EventTeam>[]) =>
  commitWrites(replaceMatchingWrites(event.id, matching, existing, now()));

export const saveDraftTeams = (event: WithId<PioneersEvent>, drafts: DraftTeam[], existing: WithId<EventTeam>[], groupSize: number, constraints: DrawConstraints) =>
  commitWrites(draftTeamsWrites(event, drafts, existing, groupSize, constraints, now()));

export const publishTeams = (event: WithId<PioneersEvent>, drafts: DraftTeam[], existing: WithId<EventTeam>[], fullNameOf: FullNameOf, groupSize: number) =>
  commitWrites(publishTeamsWrites(event, drafts, existing, fullNameOf, groupSize, now()));

export const updatePublishedTeams = (
  event: WithId<PioneersEvent>,
  drafts: DraftTeam[],
  existing: WithId<EventTeam>[],
  memberships: readonly WithId<Membership>[],
  fullNameOf: FullNameOf,
  withResults: ReadonlySet<string>,
  absentIds: ReadonlySet<string>,
) => commitWrites(publishedTeamsWrites(event, drafts, existing, memberships, fullNameOf, withResults, absentIds));

export const refreshPublicNames = (event: WithId<PioneersEvent>, teams: WithId<EventTeam>[], fullNameOf: FullNameOf) =>
  commitWrites(publicNamesWrites(event.id, teams, fullNameOf));
