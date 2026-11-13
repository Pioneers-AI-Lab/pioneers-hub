"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Box, Button, Group, Modal, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  GENERATOR_PRESETS,
  GROUP_SIZE_MIN,
  GROUP_SIZES,
  assignLeaders,
  buildLeaderCounts,
  buildPairHistory,
  generateGroups,
  leaderIdOf,
  type GeneratorInput,
  pairKey,
  scoreGroups,
} from "@shared/teamGenerator";
import { matchingOf } from "@shared/events";
import type { EventTeam, Founder, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { PROFILE_CATEGORY_LABEL, formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { publishTeams, refreshPublicNames, saveDraftTeams, type DraftTeam } from "@/lib/teamsAdmin";
import { TEAM_TOOLS, type TeamToolMode } from "@/components/admin/teamModes";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { ButtonRow, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Generateur de groupes (SPECS §4.1) : equipes de challenge ou lunch roulette
// ----------------------------
// Participants (les partis sont exclus), taille, contraintes, tirage, retouche
// a la main (toucher une personne puis une autre pour les echanger, ou
// « Move here »), verrouillage, brouillon, publication.
// Chaque groupe a un leader (rotation, `assignLeaders`) : le staff peut en
// designer un autre ; un groupe qui perd le sien (echange, depart) en retire un.
// Les contraintes « keep apart / together » valent pour la session de travail :
// elles ne sont pas enregistrees.


type Pair = [string, string];

const toDrafts = (teams: WithId<EventTeam>[]): DraftTeam[] =>
  teams.map((t) => ({ name: t.name, memberIds: [...t.memberIds], leaderId: leaderIdOf(t), locked: t.locked }));

type DrawInput = Omit<GeneratorInput, "groupSize" | "fixedGroups">;

/** Un tirage : les groupes verrouilles restent tels quels, les autres sont tires puis numerotes. */
function drawGroups(groups: DraftTeam[], groupSize: number, input: DrawInput, groupLabel: string): DraftTeam[] {
  const locked = groups.filter((g) => g.locked);
  const result = generateGroups({ ...input, groupSize, fixedGroups: locked.map((g, i) => ({ key: String(i), memberIds: g.memberIds })) });
  const next = [...locked, ...result.groups.map((memberIds) => ({ name: "", memberIds, leaderId: null, locked: false }))];
  return next.map((g, i) => ({ ...g, name: g.locked && g.name ? g.name : `${groupLabel} ${i + 1}` }));
}

/** « Alice Martin (leader) » : le nom, marque s'il mene le groupe. */
const withLeaderMark = (name: string, isLeader: boolean) => (isLeader ? `${name} (leader)` : name);

export function TeamGenerator() {
  const { isLoading } = useAdmin();
  const { event, teams, matching } = useAdminEvent();
  const isPublished = teams.some((t) => t.publishedDateISOString !== null);
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
  return isPublished ? <PublishedTeams mode={mode} /> : <GeneratorWorkspace key={event.id} mode={mode} />;
}

// ---- Equipes publiees : lecture seule ---------------------------------------------

function PublishedTeams({ mode }: { mode: TeamToolMode }) {
  const tool = TEAM_TOOLS[mode];
  const { foundersById } = useAdmin();
  const { event, teams } = useAdminEvent();
  const nameOf = (id: string) => foundersById.get(id)?.name ?? id;
  const publishedOn = teams.find((t) => t.publishedDateISOString)?.publishedDateISOString ?? null;
  // Un lien public (sans compte) a partager dans le channel du batch.
  const publicPath = paths.groups(event.id);
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
    <>
      <EventHeader mode={mode} />
      <Text size="sm" c="dimmed">
        Published {formatDateTime(publishedOn)}. Founders see their {tool.groupWord}, and the pairs count for the next draws.
        Anyone with the link sees the {tool.groupWord}s, with first names and last initials only.
      </Text>
      {missingNames && (
        <Section title="Public page" hint={`These ${tool.groupWord}s were published before the public page existed: their names are missing there.`}>
          <Button variant="default" loading={isFixing} onClick={fixNames}>
            Add names to the public page
          </Button>
        </Section>
      )}
      <Section title={`${tool.groupLabel}s · ${teams.length}`} hint={tool.leaderReminder}>
        <RowList>
          {teams.map((t) => {
            const leaderId = leaderIdOf(t);
            return (
              <Row
                key={t.id}
                title={t.name}
                subtitle={t.memberIds.map((id) => withLeaderMark(nameOf(id), id === leaderId)).join(", ")}
                meta={String(t.memberIds.length)}
              />
            );
          })}
        </RowList>
      </Section>
      <Box className="savebar">
        <Group grow gap="xs">
          <Button size="md" variant="default" component={Link} href={publicPath} target="_blank">
            Open
          </Button>
          <Button size="md" onClick={() => clipboard.copy(`${window.location.origin}${publicPath}`)}>
            {clipboard.copied ? "Copied" : "Copy public link"}
          </Button>
        </Group>
      </Box>
    </>
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
  const { founders, foundersById, teamMemberships, eventsById } = useAdmin();
  const { event, teams, absentIds, matching } = useAdminEvent();

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    // Un nouveau tirage part des presents (les absents releves sont decoches).
    const placed = teams.flatMap((t) => t.memberIds);
    return new Set(placed.length > 0 ? placed : eligible.filter((f) => !absentIds.has(f.id)).map((f) => f.id));
  });
  const participants = useMemo(
    () => eligible.filter((f) => selectedIds.has(f.id)).map((f) => ({ id: f.id, category: f.profileCategory })),
    [eligible, selectedIds],
  );
  const [size, setSize] = useState(String(matching?.size.max ?? preset.defaultSize));
  // Taille du tirage affiche, enregistree avec lui dans le matching de l'evenement.
  const [drawnSize, setDrawnSize] = useState(Number(size));
  const [keepApart, setKeepApart] = useState<Pair[]>([]);
  const [keepTogether, setKeepTogether] = useState<Pair[]>([]);
  const drawInput: DrawInput = { participants, history, rules: preset.rules, keepApart, keepTogether, groupWord: tool.groupWord };
  // Un brouillon d'avant les leaders en recoit a l'ouverture : a enregistrer.
  const [groups, setGroups] = useState<DraftTeam[]>(() => assignLeaders(toDrafts(teams), leaderCounts));
  const [picked, setPicked] = useState<string | null>(null);
  const [showParticipants, setShowParticipants] = useState(teams.length === 0);
  const [isDirty, setIsDirty] = useState(() => groups.length !== teams.length || groups.some((g, i) => g.leaderId !== leaderIdOf(teams[i])));
  const [isSaving, setIsSaving] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const report = scoreGroups(
    groups.map((g) => g.memberIds),
    drawInput,
  );

  const placed = new Set(groups.flatMap((g) => g.memberIds));
  const unplaced = participants.filter((p) => !placed.has(p.id)).map((p) => p.id);
  const nameOf = (id: string) => foundersById.get(id)?.name ?? id;

  const update = (next: DraftTeam[]) => {
    setGroups(assignLeaders(next, leaderCounts));
    setIsDirty(true);
  };

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
      if (placed.has(id)) update(groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== id) })).filter((g) => g.memberIds.length > 0));
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
    update([
      ...groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== picked) })).filter((g) => g.memberIds.length > 0),
      { name: `${tool.groupLabel} ${groups.length + 1}`, memberIds: [picked], leaderId: null, locked: false },
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

  const save = async (publish: boolean) => {
    setIsSaving(true);
    try {
      // Numerotation continue : l'id d'equipe suit la position.
      const drafts = groups.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
      if (publish) await publishTeams(event, drafts, teams, nameOf, drawnSize);
      else await saveDraftTeams(event, drafts, teams, drawnSize);
      setIsDirty(false);
      setConfirmPublish(false);
      notifications.show({ message: publish ? `${tool.groupLabel}s published` : "Draft saved" });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <EventHeader mode={mode} />

      <Section
        title={`Participants · ${participants.length}/${eligible.length}`}
        right={
          <Button variant="subtle" size="compact-sm" onClick={() => setShowParticipants((v) => !v)}>
            {showParticipants ? "Hide" : "Edit"}
          </Button>
        }
        hint={`Untick the founders who are absent today${absentIds.size > 0 ? ` (${absentIds.size} marked absent in the event's attendance, already unticked)` : ""}. Founders who left the program are not listed.`}
      >
        {showParticipants && (
          <>
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
            <RowList>
              {eligible.map((f) => (
                <ButtonRow
                  key={f.id}
                  onClick={() => toggleParticipant(f.id)}
                  title={f.name}
                  subtitle={categoryLabel(f)}
                  meta={
                    <Text size="sm" fw={600} c={selectedIds.has(f.id) ? "pioneers" : "dimmed"}>
                      {selectedIds.has(f.id) ? "In" : "Out"}
                    </Text>
                  }
                />
              ))}
            </RowList>
          </>
        )}
      </Section>

      <Section title={`${tool.groupLabel} size`}>
        <SegmentedControl fullWidth value={size} onChange={setSize} data={GROUP_SIZES} />
      </Section>

      <PairEditor
        title="Keep apart"
        hint="Never in the same group."
        pairs={keepApart}
        onChange={setKeepApart}
        candidates={eligible.filter((f) => selectedIds.has(f.id))}
      />
      <PairEditor
        title="Keep together"
        hint="Co-founders already formed: always in the same group."
        pairs={keepTogether}
        onChange={setKeepTogether}
        candidates={eligible.filter((f) => selectedIds.has(f.id))}
      />

      <Section title="Rules" hint={tool.rulesHint}>
        <Button size="md" fullWidth onClick={draw} disabled={participants.length < GROUP_SIZE_MIN}>
          {groups.length > 0 ? "Draw again" : "Draw"}
        </Button>
        {groups.some((g) => g.locked) && (
          <Text size="xs" c="dimmed" ta="center">
            Locked {tool.groupWord}s are kept as they are.
          </Text>
        )}
      </Section>

      {groups.length > 0 && (
        <Section
          title={`${tool.groupLabel}s · ${groups.length}`}
          hint={picked ? `${nameOf(picked)} selected: tap someone to swap, or "Move here".` : "Tap a person, then another one to swap them."}
        >
          <Text fw={600}>{report.summary}</Text>
          {report.relaxed.map((line) => (
            <Text key={line} size="sm" c="yellow.4">
              {line}
            </Text>
          ))}
          <Text size="sm" c="dimmed" mt="xs">
            {tool.leaderReminder}
          </Text>
          <Stack gap="md" mt="xs">
            {groups.map((g, index) => (
              <Box key={index} pb="sm" style={{ borderBottom: "1px solid var(--mantine-color-dark-5)" }}>
                <Group justify="space-between" wrap="nowrap" mb={6}>
                  <Text fw={600}>
                    {g.name} <Text span c="dimmed" size="sm" className="num">· {g.memberIds.length}</Text>
                  </Text>
                  <Group gap={4} wrap="nowrap">
                    {picked && !g.locked && pickedIndex !== index && (
                      <Button size="compact-sm" variant="light" onClick={() => moveHere(index)}>
                        Move here
                      </Button>
                    )}
                    <Button size="compact-sm" variant={g.locked ? "filled" : "default"} onClick={() => toggleLock(index)}>
                      {g.locked ? "Locked" : "Lock"}
                    </Button>
                  </Group>
                </Group>
                <Group gap={6}>
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
        <Section title={`Not placed · ${unplaced.length}`} hint={`Tap a person, then "Move here" on a ${tool.groupWord}. Or draw again.`}>
          <Group gap={6}>
            {unplaced.map((id) => (
              <MemberButton key={id} founder={foundersById.get(id)} fallback={id} isPicked={picked === id} onClick={() => setPicked(picked === id ? null : id)} />
            ))}
          </Group>
        </Section>
      )}

      {groups.length > 0 && (
        <Box className="savebar">
          <Group grow gap="xs">
            <Button size="md" variant="default" loading={isSaving} disabled={!isDirty} onClick={() => save(false)}>
              {isDirty ? "Save draft" : "Saved"}
            </Button>
            <Button size="md" disabled={unplaced.length > 0 || isSaving} onClick={() => setConfirmPublish(true)}>
              Publish
            </Button>
          </Group>
          {unplaced.length > 0 && (
            <Text size="xs" c="dimmed" ta="center" mt={6}>
              Place everyone before publishing.
            </Text>
          )}
        </Box>
      )}

      <Modal opened={confirmPublish} onClose={() => setConfirmPublish(false)} title={`Publish ${groups.length} ${tool.groupWord}s?`} centered>
        <Stack>
          <Text size="sm">
            Founders will see their {tool.groupWord}, and each pair counts in the history of the next draws. Published{" "}
            {tool.groupWord}s can no longer be changed here. You then get a public link to share: first names and last initials
            only.
          </Text>
          <Button size="md" fullWidth loading={isSaving} onClick={() => save(true)}>
            Publish
          </Button>
        </Stack>
      </Modal>
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
  hint,
  pairs,
  onChange,
  candidates,
}: {
  title: string;
  hint: string;
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
    <Section title={`${title}${pairs.length > 0 ? ` · ${pairs.length}` : ""}`} hint={hint}>
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
