"use client";

import { useState, type ReactNode } from "react";
import { Box, Button, Group, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { isSlackChannelId, isSlackTeamId } from "@shared/slackLinks";
import type { Batch, BatchStatus, LeaderboardVisibility, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { updateBatch } from "@/lib/batchAdmin";
import { paths } from "@/lib/paths";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { CreateBatchButton, CreateProgramButton } from "@/components/admin/CreateDialogs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";

// Admin > Batch settings : statut, jalons (compte a rebours de l'accueil),
// visibilite du leaderboard (masque pendant les mutual picks, SPECS §12 q.1),
// Slack. Et la creation d'un programme ou d'un batch.
export default function BatchSettingsPage() {
  const { batch, batches, programs, selectBatch } = useAdmin();
  return (
    <>
      <PageHeader back={{ href: paths.admin(), label: "Admin" }} title="Batch settings" />
      <BatchPicker />
      {/* Remonte a chaque modification distante ou changement de batch : le brouillon repart de la base. */}
      <SettingsForm key={`${batch.id}:${batch.updatedDateISOString}`} batch={batch}>
        <Section title="Programs and batches" hint={`${programs.length} programs, ${batches.length} batches. A new batch becomes the one you work on.`}>
          <Group>
            <CreateBatchButton programs={programs} defaultProgramId={batch.programId} onCreated={selectBatch} />
            <CreateProgramButton />
          </Group>
        </Section>
      </SettingsForm>
    </>
  );
}

/** `children` : ce qui s'affiche sous les reglages, avant la barre d'enregistrement. */
function SettingsForm({ batch, children }: { batch: WithId<Batch>; children: ReactNode }) {
  const [status, setStatus] = useState<BatchStatus>(batch.status);
  const [visibility, setVisibility] = useState<LeaderboardVisibility>(batch.settings.leaderboardVisibility);
  const [endDay, setEndDay] = useState(batch.endDayString ?? "");
  const [milestones, setMilestones] = useState(batch.milestones);
  const [slackTeamId, setSlackTeamId] = useState(batch.settings.slackTeamId ?? "");
  const [slackChannelId, setSlackChannelId] = useState(batch.settings.slackChannelId ?? "");
  const teamId = slackTeamId.trim().toUpperCase() || null;
  const channelId = slackChannelId.trim().toUpperCase() || null;
  const teamError = teamId && !isSlackTeamId(teamId) ? "A workspace ID starts with T, like T0123ABCD." : null;
  const channelError = channelId && !isSlackChannelId(channelId) ? "A channel ID starts with C (or G), like C0123ABCD." : null;
  const [isSaving, setIsSaving] = useState(false);

  const dirty =
    status !== batch.status ||
    visibility !== batch.settings.leaderboardVisibility ||
    (endDay || null) !== batch.endDayString ||
    JSON.stringify(milestones) !== JSON.stringify(batch.milestones) ||
    teamId !== (batch.settings.slackTeamId ?? null) ||
    channelId !== batch.settings.slackChannelId;

  const save = async () => {
    setIsSaving(true);
    try {
      await updateBatch(batch.id, {
        status,
        endDayString: endDay || null,
        milestones,
        settings: { ...batch.settings, leaderboardVisibility: visibility, slackTeamId: teamId, slackChannelId: channelId },
      });
      notifications.show({ message: "Settings saved" });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Section title="Status">
        <SegmentedControl
          fullWidth
          value={status}
          onChange={(v) => setStatus(v as BatchStatus)}
          data={[
            { value: "upcoming", label: "Upcoming" },
            { value: "active", label: "Live" },
            { value: "completed", label: "Completed" },
          ]}
        />
      </Section>

      <Section title="Leaderboard" hint="Hide it from founders during the mutual picks. Staff and investors always see it.">
        <SegmentedControl
          fullWidth
          value={visibility}
          onChange={(v) => setVisibility(v as LeaderboardVisibility)}
          data={[
            { value: "visible", label: "Visible" },
            { value: "hidden", label: "Hidden" },
          ]}
        />
      </Section>

      <Section
        title="Slack"
        hint="Opens the workspace from the batch home, and a direct message with a founder from their profile. Workspace ID: Slack, workspace settings. Channel ID: bottom of the channel details."
      >
        <Stack>
          <TextInput label="Workspace ID" placeholder="T0123ABCD" value={slackTeamId} error={teamError} onChange={(e) => setSlackTeamId(e.currentTarget.value)} />
          <TextInput label="Batch channel ID" placeholder="C0123ABCD" value={slackChannelId} error={channelError} onChange={(e) => setSlackChannelId(e.currentTarget.value)} />
        </Stack>
      </Section>

      <Section title="Dates">
        <Stack>
          <TextInput label="Start" type="date" value={batch.startDayString} disabled description="Set at creation." />
          <TextInput label="End" type="date" value={endDay} onChange={(e) => setEndDay(e.currentTarget.value)} />
          {milestones.map((m, i) => (
            <TextInput
              key={m.key}
              label={m.label}
              type="date"
              value={m.dayString ?? ""}
              onChange={(e) => {
                const day = e.currentTarget.value || null;
                setMilestones((list) => list.map((x, j) => (j === i ? { ...x, dayString: day } : x)));
              }}
            />
          ))}
        </Stack>
      </Section>

      {children}

      <Box className="savebar">
        <Button size="md" fullWidth disabled={!dirty || teamError !== null || channelError !== null} loading={isSaving} onClick={save}>
          {dirty ? "Save settings" : "No changes"}
        </Button>
        {!dirty && (
          <Text size="xs" c="dimmed" ta="center" mt={6}>
            Changes apply to everyone right away.
          </Text>
        )}
      </Box>
    </>
  );
}
