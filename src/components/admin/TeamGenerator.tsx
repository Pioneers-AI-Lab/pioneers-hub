"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Box, Button, Group, Modal, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  GENERATOR_PRESETS,
  GROUP_SIZE_MAX,
  GROUP_SIZE_MIN,
  buildPairHistory,
  generateGroups,
  pairKey,
  scoreGroups,
} from "@shared/teamGenerator";
import type { EventTeam, Founder, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { PROFILE_CATEGORY_LABEL, formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { publishTeams, refreshPublicNames, saveDraftTeams, type DraftTeam } from "@/lib/teamsAdmin";
import { TEAM_TOOLS, type TeamToolMode } from "@/components/admin/teamModes";
import { PageHeader } from "@/components/ui/PageHeader";
import { ButtonRow, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Generateur de groupes (SPECS §4.1) : equipes de challenge ou lunch roulette
// ----------------------------
// Participants (les partis sont exclus), taille, contraintes, tirage, retouche
// a la main (toucher une personne puis une autre pour les echanger, ou
// « Move here »), verrouillage, brouillon, publication.
// Les contraintes « keep apart / together » valent pour la session de travail :
// elles ne sont pas enregistrees.

const SIZES = Array.from({ length: GROUP_SIZE_MAX - GROUP_SIZE_MIN + 1 }, (_, i) => String(GROUP_SIZE_MIN + i));

type Pair = [string, string];

const toDrafts = (teams: WithId<EventTeam>[]): DraftTeam[] =>
  teams.map((t) => ({ name: t.name, memberIds: [...t.memberIds], locked: t.locked }));

export function TeamGenerator({ mode }: { mode: TeamToolMode }) {
  const { event, teams } = useAdminEvent();
  const isPublished = teams.some((t) => t.publishedDateISOString !== null);
  // L'espace de travail part des equipes enregistrees a l'ouverture, puis garde
  // son etat (contraintes, selection) a chaque enregistrement du brouillon.
  return isPublished ? <PublishedTeams mode={mode} /> : <GeneratorWorkspace key={event.id} mode={mode} />;
}

// ---- Equipes publiees : lecture seule ---------------------------------------------

function PublishedTeams({ mode }: { mode: TeamToolMode }) {
  const tool = TEAM_TOOLS[mode];
  const { foundersById } = useAdmin();
  const { event, teams } = useAdminEvent();
  const nameOf = (id: string) => foundersById.get(id)?.name ?? id;
  const publishedOn = teams.find((t) => t.publishedDateISOString)?.publishedDateISOString ?? null;
  // Lunch roulette : un lien public (sans compte) remplace le texte a coller.
  const hasPublicPage = mode === "matching";
  const publicPath = paths.lunchRoulette(event.id);
  const missingNames = hasPublicPage && teams.some((t) => !t.memberNames || t.memberNames.length !== t.memberIds.length);
  const [isFixing, setIsFixing] = useState(false);

  const copyText = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notifications.show({ message: done });
    } catch {
      notifications.show({ color: "red", message: `Copy failed. Copy it by hand: ${text.slice(0, 120)}` });
    }
  };
  const copy = () =>
    hasPublicPage
      ? copyText(`${window.location.origin}${publicPath}`, "Link copied. Share it in the batch channel.")
      : copyText(
          [`*${event.name}*`, ...teams.map((t) => `${t.name}: ${t.memberIds.map(nameOf).join(", ")}`)].join("\n"),
          "Copied. Paste it in the batch channel.",
        );

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
        {hasPublicPage && " Anyone with the link sees the tables, with first names and last initials only."}
      </Text>
      {missingNames && (
        <Section title="Public page" hint="These tables were published before the public page existed: their names are missing there.">
          <Button variant="default" loading={isFixing} onClick={fixNames}>
            Add names to the public page
          </Button>
        </Section>
      )}
      <Section title={`${tool.groupLabel}s · ${teams.length}`}>
        <RowList>
          {teams.map((t) => (
            <Row key={t.id} title={t.name} subtitle={t.memberIds.map(nameOf).join(", ")} meta={String(t.memberIds.length)} />
          ))}
        </RowList>
      </Section>
      <Box className="savebar">
        {hasPublicPage ? (
          <Group grow gap="xs">
            <Button size="md" variant="default" component={Link} href={publicPath} target="_blank">
              Open
            </Button>
            <Button size="md" onClick={copy}>
              Copy public link
            </Button>
          </Group>
        ) : (
          <Button size="md" fullWidth variant="default" onClick={copy}>
            Copy for Slack
          </Button>
        )}
      </Box>
    </>
  );
}

function EventHeader({ mode }: { mode: TeamToolMode }) {
  const tool = TEAM_TOOLS[mode];
  const { event } = useAdminEvent();
  return (
    <PageHeader
      back={{ href: tool.listHref(), label: tool.title }}
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
  const { event, teams } = useAdminEvent();

  // Les partis gardent leur historique mais ne sont plus proposes (SPECS §4.1).
  const eligible = useMemo(() => founders.filter((f) => f.status !== "left"), [founders]);
  const [groups, setGroups] = useState<DraftTeam[]>(() => toDrafts(teams));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const placed = teams.flatMap((t) => t.memberIds);
    return new Set(placed.length > 0 ? placed : eligible.map((f) => f.id));
  });
  const [size, setSize] = useState(String(event.teamSize?.max ?? preset.defaultSize));
  const [keepApart, setKeepApart] = useState<Pair[]>([]);
  const [keepTogether, setKeepTogether] = useState<Pair[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [showParticipants, setShowParticipants] = useState(teams.length === 0);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const history = useMemo(
    () => buildPairHistory(teamMemberships, (id) => eventsById.get(id)?.kind ?? null, event.id),
    [teamMemberships, eventsById, event.id],
  );
  const participants = useMemo(
    () => eligible.filter((f) => selectedIds.has(f.id)).map((f) => ({ id: f.id, category: f.profileCategory })),
    [eligible, selectedIds],
  );
  const scoringInput = { participants, history, rules: preset.rules, keepApart, keepTogether, groupWord: tool.groupWord };
  const report = scoreGroups(
    groups.map((g) => g.memberIds),
    scoringInput,
  );

  const placed = new Set(groups.flatMap((g) => g.memberIds));
  const unplaced = participants.filter((p) => !placed.has(p.id)).map((p) => p.id);
  const nameOf = (id: string) => foundersById.get(id)?.name ?? id;

  const update = (next: DraftTeam[]) => {
    setGroups(next);
    setIsDirty(true);
  };

  const draw = () => {
    const locked = groups.filter((g) => g.locked);
    const result = generateGroups({
      ...scoringInput,
      groupSize: Number(size),
      fixedGroups: locked.map((g, i) => ({ key: String(i), memberIds: g.memberIds })),
    });
    const next = [...locked, ...result.groups.map((memberIds) => ({ name: "", memberIds, locked: false }))];
    update(next.map((g, i) => ({ ...g, name: g.locked && g.name ? g.name : `${tool.groupLabel} ${i + 1}` })));
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
      { name: `${tool.groupLabel} ${groups.length + 1}`, memberIds: [picked], locked: false },
    ]);
    setPicked(null);
  };

  const toggleLock = (index: number) => update(groups.map((g, i) => (i === index ? { ...g, locked: !g.locked } : g)));

  const save = async (publish: boolean) => {
    setIsSaving(true);
    try {
      // Numerotation continue : l'id d'equipe suit la position.
      const drafts = groups.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
      if (publish) await publishTeams(event, drafts, teams, nameOf);
      else await saveDraftTeams(event, drafts, teams);
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
        hint="Untick the founders who are absent today. Founders who left the program are not listed."
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
        <SegmentedControl fullWidth value={size} onChange={setSize} data={SIZES} />
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
          <Stack gap="md" mt="xs">
            {groups.map((g, index) => (
              <Box key={index} pb="sm" style={{ borderBottom: "1px solid var(--mantine-color-dark-5)" }}>
                <Group justify="space-between" wrap="nowrap" mb={6}>
                  <Text fw={600}>
                    {g.name} <Text span c="dimmed" size="sm" className="num">· {g.memberIds.length}</Text>
                  </Text>
                  <Group gap={4} wrap="nowrap">
                    {picked && !g.locked && groupIndexOf(picked) !== index && (
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
                      disabled={g.locked || (picked !== null && picked !== id && groups[groupIndexOf(picked)]?.locked === true)}
                      onClick={() => tapMember(id)}
                    />
                  ))}
                </Group>
              </Box>
            ))}
          </Stack>
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
            {tool.groupWord}s can no longer be changed here.
            {mode === "matching" && " You then get a public link to share: first names and last initials only."}
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
  disabled,
  onClick,
}: {
  founder: WithId<Founder> | undefined;
  fallback: string;
  isPicked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const tag = founder?.profileCategory ? PROFILE_CATEGORY_LABEL[founder.profileCategory] : "?";
  return (
    <Button size="sm" variant={isPicked ? "filled" : "default"} disabled={disabled} onClick={onClick} styles={{ label: { gap: 6 } }}>
      {founder?.name ?? fallback}
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
