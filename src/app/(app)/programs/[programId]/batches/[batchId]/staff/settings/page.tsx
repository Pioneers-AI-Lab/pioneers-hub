"use client";

import { useState } from "react";
import { Box, Button, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
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
  const [isSaving, setIsSaving] = useState(false);

  const dirty =
    status !== batch.status ||
    visibility !== batch.settings.leaderboardVisibility ||
    (endDay || null) !== batch.endDayString ||
    JSON.stringify(milestones) !== JSON.stringify(batch.milestones);

  const save = async () => {
    setIsSaving(true);
    try {
      await updateBatch(batch.id, {
        status,
        endDayString: endDay || null,
        milestones,
        settings: { ...batch.settings, leaderboardVisibility: visibility },
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
        <Button size="md" fullWidth disabled={!dirty} loading={isSaving} onClick={save}>
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
