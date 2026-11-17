"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Box, Button, Group, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  GENERATOR_PRESETS,
  GROUP_SIZE_MIN,
  GROUP_SIZES,
  assignLeaders,
  buildLeaderCounts,
  buildPairHistory,
  buildPairPreferences,
  generateGroups,
  groupNumber,
  leaderIdOf,
  publishedDateOf,
  type GeneratorInput,
  pairKey,
  scoreGroups,
  startupFixedGroups,
} from "@shared/teamGenerator";
import { matchingOf } from "@shared/events";
import { sameIds } from "@shared/kpis";
import { readConnections, type DrawConstraints, type EventTeam, type Founder, type WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { useDocsListener } from "@/hooks/useFirestoreListener";
import { refs } from "@/lib/firestore/refs";
import { PROFILE_CATEGORY_LABEL, formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { publishTeams, refreshPublicNames, saveDraftTeams, teamIdFor, updatePublishedTeams, type DraftTeam } from "@/lib/teamsAdmin";
import { TEAM_TOOLS, type TeamToolMode } from "@/components/admin/teamModes";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Generateur de groupes (SPECS §4.1) : equipes de challenge ou lunch roulette
// ----------------------------
// Participants (les partis sont exclus), taille, contraintes, tirage, retouche
// a la main (toucher une personne puis une autre pour les echanger, ou
// « Move here »), verrouillage, brouillon, publication.
// Chaque groupe a un leader (rotation, `assignLeaders`) : le staff peut en
// designer un autre ; un groupe qui perd le sien (echange, depart) en retire un.
// Les contraintes « keep apart / together » s'enregistrent avec le brouillon
// (`drawConstraints`) et tombent a la publication (equipes publiques).
// Un tirage publie se retouche encore (decision du 15/11) : memes gestes, plus
// un retard a placer ou un absent a retirer, sans nouveau tirage ni verrou ; chaque
// enregistrement est confirme (`updatePublishedTeams`, lib/teamsAdmin.ts).
// Shortlists et « Met » des fondateurs (`private/connections`, lisibles par le
// staff) : ecoutes ici, sur cette page seulement, et passees au generateur
// (`buildPairPreferences`) ; le tirage attend qu'elles soient toutes arrivees.
// Matching `lockedTeamsFromStartups` (H5) : les startups du batch arrivent en
// equipes verrouillees, a leur nom, avant tout tirage (`startupFixedGroups`) ; le
// tirage place les autres fondateurs.


type Pair = [string, string];

// Une equipe publiee est enregistree verrouillee (le generateur n'y touche plus) ;
// a la retouche, plus de tirage : rien n'y est verrouille.
const toDrafts = (teams: WithId<EventTeam>[]): DraftTeam[] =>
  teams.map((t) => ({ id: t.id, name: t.name, memberIds: [...t.memberIds], leaderId: leaderIdOf(t), locked: t.locked && t.publishedDateISOString === null }));

/** Les paires enregistrees avec le brouillon (les memes sur chaque equipe). */
const savedPairs = (teams: WithId<EventTeam>[], key: keyof DrawConstraints): Pair[] =>
  (teams[0]?.drawConstraints?.[key] ?? []).map((k) => k.split("|") as Pair);

const pairKeys = (pairs: Pair[]) => pairs.map(([a, b]) => pairKey(a, b));

type DrawInput = Omit<GeneratorInput, "groupSize" | "fixedGroups">;

/** Un tirage : les groupes verrouilles restent tels quels, les autres sont tires puis numerotes. */
function drawGroups(groups: DraftTeam[], groupSize: number, input: DrawInput, groupLabel: string): DraftTeam[] {
  const locked = groups.filter((g) => g.locked);
  const result = generateGroups({ ...input, groupSize, fixedGroups: locked.map((g, i) => ({ key: String(i), memberIds: g.memberIds })) });
  const next = [...locked, ...result.groups.map((memberIds) => ({ id: null, name: "", memberIds, leaderId: null, locked: false }))];
  return next.map((g, i) => ({ ...g, name: g.locked && g.name ? g.name : `${groupLabel} ${i + 1}` }));
}

/** Les groupes sans ces personnes ; un groupe vide disparait (le leader parti est remplace par `assignLeaders`). */
const withoutMembers = (groups: DraftTeam[], ids: ReadonlySet<string>): DraftTeam[] =>
  groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => !ids.has(m)) })).filter((g) => g.memberIds.length > 0);

/** Les startups en equipes verrouillees, a leur nom, et les autres groupes sans leurs fondateurs. */
const withStartupTeams = (groups: DraftTeam[], startupGroups: { name: string; memberIds: string[] }[]): DraftTeam[] => [
  ...startupGroups.map((g) => ({ id: null, name: g.name, memberIds: [...g.memberIds], leaderId: null, locked: true })),
  ...withoutMembers(groups, new Set(startupGroups.flatMap((g) => g.memberIds))),
];

/** « Alice Martin (leader) » : le nom, marque s'il mene le groupe. */
const withLeaderMark = (name: string, isLeader: boolean) => (isLeader ? `${name} (leader)` : name);

export function TeamGenerator() {
  const { isLoading } = useAdmin();
  const { event, matching, isDrawPublished: isPublished } = useAdminEvent();
  // L'espace de travail part des equipes enregistrees a l'ouverture, puis garde
  // son etat (contraintes, selection) a chaque enregistrement du brouillon : il
  // attend donc les fondateurs et l'historique du batch.
  if (isLoading) return <PageLoader />;
  // Le mode vient du matching de l'evenement (SPECS §2), plus de son type.
  if (!matching || event.archivedDateISOString !== null) {
    return (
      <>
        <PageHeader back={{ href: paths.adminEvent(event.id), label: event.name }} title="Draw" />
        <Empty>{event.archivedDateISOString ? "This event is archived." : "This event has no matching: add teams or tables on its page."}</Empty>
      </>
    );
  }
  const mode = matching.mode;
  // Remonte a la publication : la retouche part des equipes publiees (leurs ids).
  return <GeneratorWorkspace key={`${event.id}:${isPublished}`} mode={mode} />;
}

// ---- Tirage publie : lien public ---------------------------------------------------

function PublishedSection({ mode }: { mode: TeamToolMode }) {
  const tool = TEAM_TOOLS[mode];
  const { foundersById } = useAdmin();
  const { event, teams } = useAdminEvent();
  const nameOf = (id: string) => foundersById.get(id)?.name ?? id;
  const publishedOn = publishedDateOf(teams);
  // Un lien public (sans compte) a partager dans le channel du batch.
  const publicPath = paths.groups(event.id, mode);
  const missingNames = teams.some((t) => !t.memberNames || t.memberNames.length !== t.memberIds.length);
  const [isFixing, setIsFixing] = useState(false);

  const clipboard = useClipboard({ timeout: 1500 });

  const fixNames = async () => {
    setIsFixing(true);
    try {
      await refreshPublicNames(event, teams, nameOf);
      notifications.show({ message: "Names added to the public page" });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsFixing(false);
    }
  };

  return (
    <Section
      title="Published"
      hint={`Published ${formatDateTime(publishedOn)}.`}
      help={`Founders see their ${tool.groupWord}, and the pairs count for the next draws. Anyone with the link sees the ${tool.groupWord}s, with first names and last initials only. You can still swap, move or change a leader below.`}
    >
      <Group grow gap="xs">
        <Button variant="default" component={Link} href={publicPath} target="_blank">
          Open
        </Button>
        <Button variant="default" onClick={() => clipboard.copy(`${window.location.origin}${publicPath}`)}>
          {clipboard.copied ? "Copied" : "Copy public link"}
        </Button>
      </Group>
      {missingNames && (
        <>
          <Text size="sm" c="dimmed">
            These {tool.groupWord}s were published before the public page existed: their names are missing there.
          </Text>
          <Button variant="default" loading={isFixing} onClick={fixNames}>
            Add names to the public page
          </Button>
        </>
      )}
    </Section>
  );
}

function EventHeader({ mode }: { mode: TeamToolMode }) {
  const tool = TEAM_TOOLS[mode];
  const { event } = useAdminEvent();
  return (
    <PageHeader
      back={{ href: paths.adminEvent(event.id), label: `${event.name} · ${tool.title}` }}
      title={event.name}
      subtitle={[formatDateTime(event.startDateISOString), event.location].filter(Boolean).join(" · ")}
    />
  );
}

// ---- Espace de tirage ---------------------------------------------------------------

function GeneratorWorkspace({ mode }: { mode: TeamToolMode }) {
  const tool = TEAM_TOOLS[mode];
  const preset = GENERATOR_PRESETS[mode];
  const { founders, foundersById, teamMemberships, eventsById, startups } = useAdmin();
  const { event, teams, absentIds, matching, isDrawPublished: isPublished, submissionsByTeamId, evaluations } = useAdminEvent();

  // Les partis gardent leur historique mais ne sont plus proposes (SPECS §4.1).
  const eligible = useMemo(() => founders.filter((f) => f.status !== "left"), [founders]);
  // Le mode du matching de chaque evenement passe : equipes et tables ne comptent pas pareil.
  const modeOfEvent = useCallback((id: string) => {
    const e = eventsById.get(id);
    return e ? (matchingOf(e)?.mode ?? null) : null;
  }, [eventsById]);
  const leaderCounts = useMemo(
    () => buildLeaderCounts(teamMemberships, modeOfEvent, mode, event.id),
    [teamMemberships, modeOfEvent, mode, event.id],
  );
  const history = useMemo(() => buildPairHistory(teamMemberships, modeOfEvent, event.id), [teamMemberships, modeOfEvent, event.id]);
  const connectionEntries = useMemo(() => eligible.map((f) => [f.id, refs.founderConnections(f.id)] as const), [eligible]);
  const connections = useDocsListener(connectionEntries);
  const preferences = useMemo(
    () => buildPairPreferences(new Map([...connections.data].map(([id, doc]) => [id, readConnections(doc)]))),
    [connections.data],
  );
  // Le choix du staff (ceux du brouillon, sinon tout le batch) ; la presence fait
  // foi par-dessus, en direct : un absent releve n'est jamais « In » (`isIn`).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const placed = teams.flatMap((t) => t.memberIds);
    return new Set(placed.length > 0 ? placed : eligible.map((f) => f.id));
  });
  const isIn = useCallback((id: string) => selectedIds.has(id) && !absentIds.has(id), [selectedIds, absentIds]);
  const inFounders = useMemo(() => eligible.filter((f) => isIn(f.id)), [eligible, isIn]);
  const participants = useMemo(() => inFounders.map((f) => ({ id: f.id, category: f.profileCategory })), [inFounders]);
  const [size, setSize] = useState(String(matching?.size.max ?? preset.defaultSize));
  // Taille du tirage affiche, enregistree avec lui dans le matching de l'evenement.
  const [drawnSize, setDrawnSize] = useState(Number(size));
  const [keepApart, setKeepApart] = useState<Pair[]>(() => savedPairs(teams, "keepApart"));
  const [keepTogether, setKeepTogether] = useState<Pair[]>(() => savedPairs(teams, "keepTogether"));
  const drawInput = useMemo<DrawInput>(
    () => ({ participants, history, preferences, rules: preset.rules, keepApart, keepTogether, groupWord: tool.groupWord }),
    [participants, history, preferences, preset.rules, keepApart, keepTogether, tool.groupWord],
  );
  const [groups, setGroups] = useState<DraftTeam[]>(() => assignLeaders(withoutMembers(toDrafts(teams), absentIds), leaderCounts));
  const [picked, setPicked] = useState<string | null>(null);
  const [showParticipants, setShowParticipants] = useState(teams.length === 0);
  // A enregistrer : un leader attribue a l'ouverture, ou un absent retire du brouillon.
  const [isDirty, setIsDirty] = useState(
    () => groups.length !== teams.length || groups.some((g, i) => g.leaderId !== leaderIdOf(teams[i]) || g.memberIds.length !== teams[i].memberIds.length),
  );
  const [isSaving, setIsSaving] = useState(false);
  // Publier, ou enregistrer une retouche du tirage publie : toujours confirme.
  const [isConfirming, setIsConfirming] = useState(false);
  const report = useMemo(() => scoreGroups(groups.map((g) => g.memberIds), drawInput), [groups, drawInput]);

  // H5 : les startups (au moins deux fondateurs presents) sont des equipes fixes.
  const startupTeams = useMemo(
    () =>
      matching?.lockedTeamsFromStartups
        ? startupFixedGroups(
            startups.filter((s) => s.status === "active"),
            new Set(participants.map((p) => p.id)),
          )
        : null,
    [matching?.lockedTeamsFromStartups, startups, participants],
  );

  const placed = new Set(groups.flatMap((g) => g.memberIds));
  const unplaced = participants.filter((p) => !placed.has(p.id)).map((p) => p.id);
  const nameOf = (id: string) => foundersById.get(id)?.name ?? id;

  const update = (next: DraftTeam[]) => {
    setGroups(assignLeaders(next, leaderCounts));
    setIsDirty(true);
  };

  // Un absent releve pendant que la page est ouverte (autre onglet, retour
  // arriere) quitte aussi son groupe : le brouillon change, il est a enregistrer.
  const [syncedAbsentIds, setSyncedAbsentIds] = useState(absentIds);
  if (syncedAbsentIds !== absentIds) {
    setSyncedAbsentIds(absentIds);
    if (groups.some((g) => g.memberIds.some((m) => absentIds.has(m)))) update(withoutMembers(groups, absentIds));
  }

  // Avant tout tirage, les startups arrivent verrouillees (elles se chargent parfois apres la page).
  const [isPrefilled, setPrefilled] = useState(teams.length > 0);
  if (!isPrefilled && startupTeams && startupTeams.groups.length > 0 && groups.length === 0) {
    setPrefilled(true);
    update(withStartupTeams([], startupTeams.groups));
  }

  const draw = () => {
    update(drawGroups(groups, Number(size), drawInput, tool.groupLabel));
    setDrawnSize(Number(size));
    setPicked(null);
  };

  const toggleParticipant = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
      // Retire aussi la personne de son groupe (absente ce jour-la).
      if (placed.has(id)) update(withoutMembers(groups, new Set([id])));
    } else next.add(id);
    setSelectedIds(next);
  };

  const groupIndexOf = (id: string) => groups.findIndex((g) => g.memberIds.includes(id));

  const tapMember = (id: string) => {
    if (picked === null || picked === id) return setPicked(picked === id ? null : id);
    const from = groupIndexOf(picked);
    const to = groupIndexOf(id);
    if (from === to) return setPicked(id);
    // Echange : une personne non placee prend la place de celle touchee, qui devient non placee.
    update(
      groups.map((g, i) => {
        if (i !== from && i !== to) return g;
        return { ...g, memberIds: g.memberIds.map((m) => (m === picked ? id : m === id ? picked : m)) };
      }),
    );
    setPicked(null);
  };

  const moveHere = (index: number) => {
    if (!picked) return;
    update(
      groups
        .map((g, i) => {
          const without = g.memberIds.filter((m) => m !== picked);
          return { ...g, memberIds: i === index ? [...without, picked] : without };
        })
        .filter((g) => g.memberIds.length > 0),
    );
    setPicked(null);
  };

  const newGroup = () => {
    if (!picked) return;
    // Le numero libre suivant ; publie, le groupe recoit aussi son id (les autres gardent le leur).
    const number = Math.max(groups.length, ...groups.map((g) => (g.id ? groupNumber(g.id) : 0)), ...teams.map((t) => groupNumber(t.id))) + 1;
    update([
      ...withoutMembers(groups, new Set([picked])),
      { id: isPublished ? teamIdFor(event.id, number - 1) : null, name: `${tool.groupLabel} ${number}`, memberIds: [picked], leaderId: null, locked: false },
    ]);
    setPicked(null);
  };

  const pickedIndex = picked ? groupIndexOf(picked) : -1;
  const pickedGroup = groups[pickedIndex] as DraftTeam | undefined;
  const makeLeader = () => {
    if (!picked) return;
    update(groups.map((g, i) => (i === pickedIndex ? { ...g, leaderId: picked } : g)));
    setPicked(null);
  };

  const toggleLock = (index: number) => update(groups.map((g, i) => (i === index ? { ...g, locked: !g.locked } : g)));

  // Retouche d'un tirage publie : les groupes changes (ou retires) qui ont deja des resultats.
  const resultTeamIds = new Set([...submissionsByTeamId.keys(), ...evaluations.map((e) => e.targetId)]);
  const changedWithResults = isPublished
    ? teams.filter((t) => resultTeamIds.has(t.id) && !groups.some((g) => g.id === t.id && sameIds(g.memberIds, t.memberIds)))
    : [];

  const save = async (publish: boolean) => {
    setIsSaving(true);
    try {
      // Brouillon et publication : numerotation continue, l'id d'equipe suit la position.
      const drafts = groups.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
      if (isPublished) await updatePublishedTeams(event, drafts, teams, teamMemberships, nameOf, resultTeamIds);
      else if (publish) await publishTeams(event, drafts, teams, nameOf, drawnSize);
      else await saveDraftTeams(event, drafts, teams, drawnSize, { keepApart: pairKeys(keepApart), keepTogether: pairKeys(keepTogether) });
      setIsDirty(false);
      setIsConfirming(false);
      notifications.show({ message: isPublished ? `${tool.groupLabel}s updated` : publish ? `${tool.groupLabel}s published` : "Draft saved" });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const setPairs = (set: (pairs: Pair[]) => void) => (pairs: Pair[]) => {
    set(pairs);
    setIsDirty(true);
  };

  return (
    <>
      <EventHeader mode={mode} />
      {isPublished && <PublishedSection mode={mode} />}

      <Section
        title={`Participants · ${participants.length}/${eligible.length}`}
        right={
          <Button variant="subtle" size="compact-sm" onClick={() => setShowParticipants((v) => !v)}>
            {showParticipants ? "Hide" : "Edit"}
          </Button>
        }
        help={`${isPublished ? "Tick a founder who arrived late, then place them; untick one who isn't there." : "Untick the founders who won't take part."} Absent founders come from the event's attendance${absentIds.size > 0 ? ` (${absentIds.size} today)` : ""}: change them there. Founders who left the program are not listed.`}
      >
        {showParticipants && (
          <>
            {/* Tout cocher ou decocher : avant publication seulement (une retouche se fait personne par personne). */}
            {!isPublished && (
              <Group gap="xs">
                <Button variant="default" size="compact-sm" onClick={() => setSelectedIds(new Set(eligible.map((f) => f.id)))}>
                  All
                </Button>
                <Button
                  variant="default"
                  size="compact-sm"
                  onClick={() => {
                    setSelectedIds(new Set());
                    if (groups.length > 0) update([]);
                  }}
                >
                  None
                </Button>
              </Group>
            )}
            <RowList>
              {eligible.map((f) => (
                <ButtonRow
                  key={f.id}
                  // Un absent se remet present dans la presence de l'evenement, pas ici.
                  disabled={absentIds.has(f.id)}
                  onClick={() => toggleParticipant(f.id)}
                  title={f.name}
                  subtitle={categoryLabel(f)}
                  meta={
                    <Text size="sm" fw={600} c={isIn(f.id) ? "pioneers" : "dimmed"}>
                      {absentIds.has(f.id) ? "Absent" : isIn(f.id) ? "In" : "Out"}
                    </Text>
                  }
                />
              ))}
            </RowList>
          </>
        )}
      </Section>

      {!isPublished && (
        <>
          <Section title={`${tool.groupLabel} size`}>
            <SegmentedControl fullWidth value={size} onChange={setSize} data={GROUP_SIZES} />
          </Section>

          <PairEditor
            title="Keep apart"
            help="Never in the same group."
            pairs={keepApart}
            onChange={setPairs(setKeepApart)}
            candidates={inFounders}
          />
          <PairEditor
            title="Keep together"
            help="Co-founders already formed: always in the same group."
            pairs={keepTogether}
            onChange={setPairs(setKeepTogether)}
            candidates={inFounders}
          />

          {startupTeams && (
            <Section
              title={`Startups · ${startupTeams.groups.length}`}
              help="This event keeps the batch's startups as teams: they are locked below, under their startup's name, and Draw only places the other founders, with the usual rules."
            >
              {startupTeams.groups.length === 0 && <Empty>No startup with two founders taking part: everyone is drawn.</Empty>}
              {startupTeams.skipped.map((s) => (
                <Text key={s.id} size="sm" c="dimmed">
                  {s.name}: fewer than two of its founders take part, so they are drawn with the others.
                </Text>
              ))}
              {startupTeams.groups.length > 0 && (
                <Button variant="default" onClick={() => update(withStartupTeams(groups, startupTeams.groups))}>
                  Lock the startups as teams again
                </Button>
              )}
            </Section>
          )}

          <Section title="Rules" help={tool.rulesHelp}>
            <Button size="md" fullWidth onClick={draw} loading={connections.isLoading} disabled={participants.length < GROUP_SIZE_MIN}>
              {groups.length > 0 ? "Draw again" : "Draw"}
            </Button>
            {groups.some((g) => g.locked) && (
              <Text size="xs" c="dimmed" ta="center">
                Locked {tool.groupWord}s are kept as they are.
              </Text>
            )}
          </Section>
        </>
      )}

      {groups.length > 0 && (
        <Section
          title={`${tool.groupLabel}s · ${groups.length}`}
          hint={picked ? `${nameOf(picked)} selected: tap someone to swap, or "Move here".` : undefined}
          help={`Tap a person, then another one to swap them. ${tool.leaderReminder}`}
        >
          <Text fw={600}>{report.summary}</Text>
          {report.relaxed.map((line) => (
            <Text key={line} size="sm" c="yellow.4">
              {line}
            </Text>
          ))}
          <Stack gap="md">
            {groups.map((g, index) => (
              <Box key={index} pb="sm" style={{ borderBottom: "1px solid var(--mantine-color-dark-5)" }}>
                <Group justify="space-between" wrap="nowrap" mb="xs">
                  <Text fw={600}>
                    {g.name} <Text span c="dimmed" size="sm" className="num">· {g.memberIds.length}</Text>
                  </Text>
                  <Group gap={4} wrap="nowrap">
                    {picked && !g.locked && pickedIndex !== index && (
                      <Button size="compact-sm" variant="light" onClick={() => moveHere(index)}>
                        Move here
                      </Button>
                    )}
                    {!isPublished && (
                      <Button size="compact-sm" variant={g.locked ? "filled" : "default"} onClick={() => toggleLock(index)}>
                        {g.locked ? "Locked" : "Lock"}
                      </Button>
                    )}
                  </Group>
                </Group>
                <Group gap="xs">
                  {g.memberIds.map((id) => (
                    <MemberButton
                      key={id}
                      founder={foundersById.get(id)}
                      fallback={id}
                      isPicked={picked === id}
                      isLeader={g.leaderId === id}
                      disabled={g.locked || (picked !== id && pickedGroup?.locked === true)}
                      onClick={() => tapMember(id)}
                    />
                  ))}
                </Group>
              </Box>
            ))}
          </Stack>
          {picked && pickedGroup && pickedGroup.leaderId !== picked && (
            <Button variant="subtle" size="compact-sm" onClick={makeLeader} w="fit-content">
              Make {nameOf(picked)} leader
            </Button>
          )}
          {picked && (
            <Button variant="subtle" size="compact-sm" onClick={newGroup} w="fit-content">
              Put {nameOf(picked)} in a new {tool.groupWord}
            </Button>
          )}
        </Section>
      )}

      {unplaced.length > 0 && groups.length > 0 && (
        <Section title={`Not placed · ${unplaced.length}`} help={`Tap a person, then "Move here" on a ${tool.groupWord}. Or draw again.`}>
          <Group gap="xs">
            {unplaced.map((id) => (
              <MemberButton key={id} founder={foundersById.get(id)} fallback={id} isPicked={picked === id} onClick={() => setPicked(picked === id ? null : id)} />
            ))}
          </Group>
        </Section>
      )}

      {groups.length > 0 && (
        <Box className="savebar">
          {isPublished ? (
            <Button size="md" fullWidth loading={isSaving} disabled={!isDirty || unplaced.length > 0} onClick={() => setIsConfirming(true)}>
              {isDirty ? "Save changes" : "Saved"}
            </Button>
          ) : (
            <Group grow gap="xs">
              <Button size="md" variant="default" loading={isSaving} disabled={!isDirty} onClick={() => save(false)}>
                {isDirty ? "Save draft" : "Saved"}
              </Button>
              <Button size="md" disabled={unplaced.length > 0 || isSaving} onClick={() => setIsConfirming(true)}>
                Publish
              </Button>
            </Group>
          )}
          {unplaced.length > 0 && (
            <Text size="xs" c="dimmed" ta="center" mt="xs">
              Place everyone before {isPublished ? "saving" : "publishing"}.
            </Text>
          )}
        </Box>
      )}

      <ResponsiveDialog
        opened={isConfirming}
        onClose={() => setIsConfirming(false)}
        title={isPublished ? `Save changes to the ${tool.groupWord}s?` : `Publish ${groups.length} ${tool.groupWord}s?`}
      >
        <Stack>
          {isPublished ? (
            <>
              <Text size="sm">
                Founders see the change right away: on the event page, in their {tool.groupWord}&apos;s forms and on the public link.
                The pairs history follows: the next draws count these {tool.groupWord}s, not the previous ones.
              </Text>
              {changedWithResults.length > 0 && (
                <Text size="sm" c="yellow.4">
                  {changedWithResults.map((t) => t.name).join(", ")} already sent results (Submission or jury scores): they stay with
                  the {tool.groupWord}. Founders who join now see the {tool.groupWord}&apos;s answers and can update them; those who
                  leave no longer see them. Peer ratings already sent are kept. The leaderboard shows the new members after the next
                  result or jury score.
                </Text>
              )}
            </>
          ) : (
            <Text size="sm">
              Founders will see their {tool.groupWord}, and each pair counts in the history of the next draws. You can still adjust
              the {tool.groupWord}s afterwards (swap, move, change a leader): founders see each change right away. You then get a
              public link to share: first names and last initials only.
            </Text>
          )}
          <Button size="md" fullWidth loading={isSaving} onClick={() => save(true)}>
            {isPublished ? "Save changes" : "Publish"}
          </Button>
        </Stack>
      </ResponsiveDialog>
    </>
  );
}

const categoryLabel = (f: Founder) => (f.profileCategory ? PROFILE_CATEGORY_LABEL[f.profileCategory] : "No profile category");

function MemberButton({
  founder,
  fallback,
  isPicked,
  isLeader = false,
  disabled,
  onClick,
}: {
  founder: WithId<Founder> | undefined;
  fallback: string;
  isPicked: boolean;
  isLeader?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const tag = founder?.profileCategory ? PROFILE_CATEGORY_LABEL[founder.profileCategory] : "?";
  return (
    <Button size="sm" variant={isPicked ? "filled" : "default"} disabled={disabled} onClick={onClick} styles={{ label: { gap: 6 } }}>
      {withLeaderMark(founder?.name ?? fallback, isLeader)}
      <Text span size="xs" c={isPicked ? "white" : "dimmed"} ml={6}>
        {tag}
      </Text>
    </Button>
  );
}

function PairEditor({
  title,
  help,
  pairs,
  onChange,
  candidates,
}: {
  title: string;
  help: string;
  pairs: Pair[];
  onChange: (pairs: Pair[]) => void;
  candidates: WithId<Founder>[];
}) {
  const { foundersById } = useAdmin();
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const data = candidates.map((f) => ({ value: f.id, label: f.name }));
  const exists = a !== null && b !== null && pairs.some(([x, y]) => pairKey(x, y) === pairKey(a, b));

  return (
    <Section title={`${title}${pairs.length > 0 ? ` · ${pairs.length}` : ""}`} help={help}>
      {pairs.length === 0 ? null : (
        <RowList>
          {pairs.map(([x, y]) => (
            <ButtonRow
              key={pairKey(x, y)}
              onClick={() => onChange(pairs.filter(([p, q]) => pairKey(p, q) !== pairKey(x, y)))}
              title={`${foundersById.get(x)?.name ?? x} and ${foundersById.get(y)?.name ?? y}`}
              meta="Remove"
            />
          ))}
        </RowList>
      )}
      <Group grow gap="xs" align="flex-end">
        <Select placeholder="Founder" searchable data={data} value={a} onChange={setA} />
        <Select placeholder="Founder" searchable data={data.filter((d) => d.value !== a)} value={b} onChange={setB} />
      </Group>
      <Button
        variant="default"
        disabled={a === null || b === null || a === b || exists}
        onClick={() => {
          if (!a || !b) return;
          onChange([...pairs, [a, b]]);
          setA(null);
          setB(null);
        }}
      >
        Add pair
      </Button>
      {candidates.length === 0 && <Empty>No participants selected.</Empty>}
    </Section>
  );
}
