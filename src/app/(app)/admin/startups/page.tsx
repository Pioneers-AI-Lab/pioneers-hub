"use client";

import { useState } from "react";
import { Button, Group, MultiSelect, Stack, Text, TextInput } from "@mantine/core";
import { STARTUP_MAX_MEMBERS, startupDraftsProblem, type LockGap, type ProposedTeam, type StartupDraft } from "@shared/teamLocks";
import { useAdmin } from "@/context/AdminContext";
import { useAdminTeamLocks } from "@/context/AdminTeamLocksContext";
import { useAction } from "@/hooks/useAction";
import { joinList } from "@/lib/format";
import { createStartups } from "@/lib/startupsAdmin";
import { paths } from "@/lib/paths";
import { ActionBar } from "@/components/admin/ActionBar";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { CompletionProgress } from "@/components/admin/CompletionProgress";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { WithHelp } from "@/components/ui/Help";

// ----------------------------
// Admin > Startups : de Lock my team aux startups (lot 2)
// ----------------------------
// Les equipes RECIPROQUES (chaque membre a repondu oui et cite exactement les autres)
// sont proposees ; le staff corrige un nom ou un membre, puis confirme : les startups,
// leurs appartenances datees et le `startupId` des fondateurs s'ecrivent en un lot
// (shared/teamLocks.ts). Les reponses incompletes ou non reciproques sont a verifier :
// le staff peut en tirer une startup a la main. « Non » : aucune startup, tire au sort au H5.

/** Ce qu'edite la fenetre : une equipe proposee (`key`), ou une startup faite a la main (`key: null`). */
type Editing = { key: string | null; draft: StartupDraft };

export default function AdminStartupsPage() {
  const { batch, founders, foundersById, startups } = useAdmin();
  const { groups, answered, notAnswered, available, isLoading } = useAdminTeamLocks();
  const [edits, setEdits] = useState<Record<string, StartupDraft>>({});
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const { busy, run } = useAction();

  if (isLoading) return <PageLoader />;

  const availableIds = new Set(available.map((f) => f.id));
  const nameOf = (id: string) => foundersById.get(id)?.name ?? id;
  const names = (ids: readonly string[]) => joinList(ids.map(nameOf));
  const draftOf = (team: ProposedTeam): StartupDraft => edits[team.key] ?? { name: team.startupNames[0] ?? "", memberIds: team.memberIds };
  const drafts = groups.proposed.map(draftOf);
  const problemOf = (list: readonly StartupDraft[]) => startupDraftsProblem(list, founders, batch.id)?.message ?? null;
  const allProblem = problemOf(drafts);

  const gapText = (gap: LockGap) =>
    ({
      not_answered: `${nameOf(gap.founderId)} has not answered`,
      said_no: `${nameOf(gap.founderId)} answered no`,
      other_team: `${nameOf(gap.founderId)} picked another team`,
      has_startup: `${nameOf(gap.founderId)} is already in a startup`,
    })[gap.kind];

  // Les fondateurs qu'on peut mettre dans une startup : sans startup, plus ceux deja choisis.
  const memberOptions = (selected: readonly string[]) =>
    [...available, ...selected.flatMap((id) => (availableIds.has(id) ? [] : (foundersById.get(id) ?? [])))].map((f) => ({ value: f.id, label: f.name }));

  const create = async (list: StartupDraft[], success: string, key: string) => {
    const ok = await run(async () => (await createStartups(batch, list, startups), true), success, key);
    if (ok) {
      setEditing(null);
      setConfirmingAll(false);
    }
  };

  const saveEdit = () => {
    if (editing?.key) setEdits((prev) => ({ ...prev, [editing.key!]: editing.draft }));
    setEditing(null);
  };

  const editingProblem = editing ? problemOf([editing.draft]) : null;

  return (
    <>
      <PageHeader
        back={{ href: paths.admin(), label: "Admin" }}
        title="Startups"
        help="From the Lock my team answers: confirm the teams where every co-founder picked the same team."
      />
      <BatchPicker />

      <Section
        title={`Proposed · ${groups.proposed.length}`}
        help="Every member answered yes and picked the same co-founders. Tap one to fix its name or members."
      >
        {groups.proposed.length === 0 ? (
          <Empty>No reciprocal team yet.</Empty>
        ) : (
          <RowList>
            {groups.proposed.map((team) => {
              const d = draftOf(team);
              return (
                <ButtonRow opens
                  key={team.key}
                  onClick={() => setEditing({ key: team.key, draft: d })}
                  title={d.name.trim() || "No name yet"}
                  subtitle={names(d.memberIds)}
                  meta={edits[team.key] ? "Edited" : `${d.memberIds.length} founders`}
                />
              );
            })}
          </RowList>
        )}
      </Section>

      <Section title={`To check · ${groups.partial.length}`} help="Locked a team, but their co-founders did not all pick the same team. Tap one to create a startup by hand.">
        {groups.partial.length === 0 ? (
          <Empty>Nothing to check.</Empty>
        ) : (
          <RowList>
            {groups.partial.map((p) => (
              <ButtonRow opens
                key={p.founderId}
                onClick={() =>
                  setEditing({
                    key: null,
                    draft: { name: p.startupName ?? "", memberIds: [p.founderId, ...p.coFounderIds].filter((id) => availableIds.has(id)) },
                  })
                }
                title={nameOf(p.founderId)}
                subtitle={p.coFounderIds.length === 0 ? "No co-founder picked" : `With ${names(p.coFounderIds)} · ${p.gaps.map(gapText).join(" · ")}`}
                meta={p.startupName ?? undefined}
              />
            ))}
          </RowList>
        )}
        <Group>
          <Button variant="default" size="md" onClick={() => setEditing({ key: null, draft: { name: "", memberIds: [] } })}>
            New startup
          </Button>
        </Group>
      </Section>

      <Section title={`No team · ${groups.noTeam.length}`} help="They answered no: no startup, drawn into a team for Hackathon 5.">
        {groups.noTeam.length === 0 ? <Empty>Nobody yet.</Empty> : <Text size="sm">{names(groups.noTeam)}</Text>}
      </Section>

      <Section title="Answers" help="Founders without a startup who answered Lock my team.">
        <CompletionProgress
          doneNames={answered.map((f) => f.name)}
          missingNames={notAnswered.map((f) => f.name)}
          basisLabel="founders without a startup"
          missingTitle="Not answered"
        />
      </Section>

      <Section title={`Startups · ${startups.length}`} help={`Already created in ${batch.name}.`}>
        {startups.length === 0 ? (
          <Empty>No startup yet.</Empty>
        ) : (
          <RowList>
            {startups.map((s) => (
              <Row key={s.id} title={s.name} subtitle={names(s.memberIds)} />
            ))}
          </RowList>
        )}
      </Section>

      {groups.proposed.length > 0 && (
        <ActionBar
          label={`Create ${groups.proposed.length} startup${groups.proposed.length === 1 ? "" : "s"}`}
          problem={allProblem}
          disabled={allProblem !== null || busy !== null}
          onClick={() => setConfirmingAll(true)}
        />
      )}

      <ResponsiveDialog opened={confirmingAll} onClose={() => setConfirmingAll(false)} title="Create these startups?">
        <Stack>
          <Text size="sm">
            {joinList(drafts.map((d) => d.name.trim()))}. Each founder joins their startup from today: it is their team for Hackathon 5 and counts for the Teamed up milestone.
          </Text>
          <Group grow>
            <Button variant="default" size="md" disabled={busy !== null} onClick={() => setConfirmingAll(false)}>
              Cancel
            </Button>
            <Button size="md" loading={busy === "all"} disabled={busy !== null} onClick={() => void create(drafts, `${drafts.length} startup(s) created.`, "all")}>
              Create
            </Button>
          </Group>
        </Stack>
      </ResponsiveDialog>

      <ResponsiveDialog opened={editing !== null} onClose={() => setEditing(null)} title={editing?.key ? "Proposed startup" : "New startup"}>
        {editing && (
          <Stack>
            <TextInput
              label="Startup name"
              withAsterisk
              value={editing.draft.name}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.currentTarget.value } })}
            />
            <WithHelp label="Founders" help="Founders of the batch without a startup.">
              {(field) => (
                <MultiSelect
                  {...field}
                  withAsterisk
                  data={memberOptions(editing.draft.memberIds)}
                  value={editing.draft.memberIds}
                  onChange={(memberIds) => setEditing({ ...editing, draft: { ...editing.draft, memberIds } })}
                  searchable
                  maxValues={STARTUP_MAX_MEMBERS}
                  hidePickedOptions
                  comboboxProps={{ withinPortal: true }}
                />
              )}
            </WithHelp>
            {editingProblem && (
              <Text size="sm" c="red.4">
                {editingProblem}
              </Text>
            )}
            {editing.key && (
              <Button variant="default" size="md" fullWidth disabled={busy !== null} onClick={saveEdit}>
                Keep these changes
              </Button>
            )}
            <Button
              size="md"
              fullWidth
              loading={busy === "one"}
              disabled={editingProblem !== null || busy !== null}
              onClick={() => void create([editing.draft], `${editing.draft.name.trim()} is created.`, "one")}
            >
              Create this startup
            </Button>
          </Stack>
        )}
      </ResponsiveDialog>
    </>
  );
}
