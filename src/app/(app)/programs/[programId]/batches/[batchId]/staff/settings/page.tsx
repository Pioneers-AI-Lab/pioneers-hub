"use client";

import { useState } from "react";
import { Box, Button, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { isSlackChannelId, isSlackTeamId } from "@shared/slackLinks";
import type { Batch, BatchStatus, LeaderboardVisibility } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { updateBatch } from "@/lib/batchAdmin";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";

// Reglages du batch : statut, jalons (compte a rebours de l'accueil),
// visibilite du leaderboard (masque pendant les mutual picks, SPECS §12 q.1).
export default function BatchSettingsPage() {
  const { batch } = useBatch();
  // Remonte a chaque modification distante : le brouillon repart de la base.
  return <SettingsForm key={batch.updatedDateISOString} batch={batch} />;
}

function SettingsForm({ batch }: { batch: Batch & { id: string } }) {
  const { program } = useProgram();
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
      <PageHeader back={{ href: paths.staff(program.id, batch.id), label: "Staff" }} title="Batch settings" />

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
        hint="Opens a direct message with a founder from their profile, and the batch channel from the batch home. Workspace ID: Slack, workspace settings. Channel ID: bottom of the channel details."
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
