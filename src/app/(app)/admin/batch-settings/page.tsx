"use client";

import { useState, type ReactNode } from "react";
import { Box, Button, Group, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { isSlackChannelId, isSlackTeamId, normalizeSlackId } from "@shared/slackLinks";
import type { Batch, BatchStatus, LeaderboardVisibility, WithId } from "@shared/types";
import { calendarIdOf } from "@shared/calendarSync";
import type { CalendarSyncResult } from "@shared/types";
import { joinList } from "@/lib/format";
import { CalendarSyncStatus } from "@/components/admin/CalendarSyncStatus";
import { useAdmin } from "@/context/AdminContext";
import { useAction } from "@/hooks/useAction";
import { updateBatch } from "@/lib/batchAdmin";
import { call } from "@/lib/firebase";
import { paths } from "@/lib/paths";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { CreateBatchButton, CreateProgramButton } from "@/components/admin/CreateDialogs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";

// Admin > Batch settings : statut, jalons (compte a rebours de l'accueil),
// visibilite du leaderboard (masque pendant les mutual picks, SPECS §12 q.1),
// Slack, l'agenda Google (SPECS §2, 16/11 : ses evenements deviennent ceux du
// batch). Et la creation d'un programme ou d'un batch.
export default function BatchSettingsPage() {
  const { batch, batches, programs, selectBatch } = useAdmin();
  return (
    <>
      <PageHeader back={{ href: paths.admin(), label: "Admin" }} title="Batch settings" />
      <BatchPicker />
      {/* Remonte a chaque modification distante ou changement de batch : le brouillon repart de la base. */}
      <SettingsForm key={`${batch.id}:${batch.updatedDateISOString}`} batch={batch}>
        <ScoresSection batch={batch} />
        <Section title="Programs and batches" help={`${programs.length} programs, ${batches.length} batches. A new batch becomes the one you work on.`}>
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
  const [calendarInput, setCalendarInput] = useState(batch.settings.googleCalendarId ?? "");
  const calendarId = calendarInput.trim() || null;
  const teamId = normalizeSlackId(slackTeamId);
  const channelId = normalizeSlackId(slackChannelId);
  const teamError = teamId && !isSlackTeamId(teamId) ? "A workspace ID starts with T, like T0123ABCD." : null;
  const channelError = channelId && !isSlackChannelId(channelId) ? "A channel ID starts with C (or G), like C0123ABCD." : null;
  const [isSaving, setIsSaving] = useState(false);

  const dirty =
    status !== batch.status ||
    visibility !== batch.settings.leaderboardVisibility ||
    (endDay || null) !== batch.endDayString ||
    JSON.stringify(milestones) !== JSON.stringify(batch.milestones) ||
    teamId !== (batch.settings.slackTeamId ?? null) ||
    channelId !== batch.settings.slackChannelId ||
    calendarId !== calendarIdOf(batch);

  const save = async () => {
    setIsSaving(true);
    try {
      await updateBatch(batch.id, {
        status,
        endDayString: endDay || null,
        milestones,
        settings: { ...batch.settings, leaderboardVisibility: visibility, slackTeamId: teamId, slackChannelId: channelId, googleCalendarId: calendarId },
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

      <Section title="Leaderboard" help="Hide it from founders during the mutual picks. Staff and investors always see it.">
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
        help="Opens the workspace from the batch home, and a direct message with a founder from their profile. Workspace ID: Slack, workspace settings. Channel ID: bottom of the channel details."
      >
        <Stack>
          <TextInput label="Workspace ID" placeholder="T0123ABCD" value={slackTeamId} error={teamError} onChange={(e) => setSlackTeamId(e.currentTarget.value)} />
          <TextInput label="Batch channel ID" placeholder="C0123ABCD" value={slackChannelId} error={channelError} onChange={(e) => setSlackChannelId(e.currentTarget.value)} />
        </Stack>
      </Section>

      <CalendarSection batch={batch} input={calendarInput} calendarId={calendarId} onChange={setCalendarInput} />

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
          <Text size="xs" c="dimmed" ta="center" mt="xs">
            Changes apply to everyone right away.
          </Text>
        )}
      </Box>
    </>
  );
}

/** Les cinq premiers noms : « Lunch, Masterclass… ». */
const firstNames = (names: string[]) => `${joinList(names.slice(0, 5))}${names.length > 5 ? "…" : ""}`;

/** Ce que la synchro a fait (ou ferait), en une phrase. */
function syncLine(r: CalendarSyncResult, dryRun: boolean): string {
  const { created, linked, updated, archived, formsMoved } = r.counts;
  const verb = dryRun ? "would" : "did";
  const parts = [
    created && `create ${created} (${firstNames(r.created)})`,
    linked && `link ${linked} existing (${firstNames(r.linked)})`,
    updated && `update ${updated}`,
    archived && `hide ${archived} removed from the calendar (${firstNames(r.archived)})`,
    formsMoved && `move ${formsMoved} forms`,
  ].filter(Boolean);
  const found = `${r.found} events in the batch's dates.`;
  return parts.length ? `${found} The sync ${verb} ${joinList(parts as string[])}.` : `${found} Nothing to change.`;
}

/**
 * L'agenda Google du batch : son id (Google Calendar > Settings > Integrate
 * calendar), partage en lecture avec le compte de service du Hub. « Check »
 * essaie l'id saisi a blanc : ce qui serait cree, relie, masque. Une fois
 * enregistre, la synchro tourne a chaque changement de l'agenda (et toutes les 30 minutes en filet).
 */
function CalendarSection({
  batch,
  input,
  calendarId,
  onChange,
}: {
  batch: WithId<Batch>;
  input: string;
  /** L'id saisi, `null` si vide. */
  calendarId: string | null;
  onChange: (v: string) => void;
}) {
  const { isBusy, busy, run } = useAction();
  const [result, setResult] = useState<{ r: CalendarSyncResult; dryRun: boolean } | null>(null);
  const isSaved = calendarId !== null && calendarId === calendarIdOf(batch);

  const go = async (dryRun: boolean) => {
    const r = await run(() => call("syncBatchCalendar")({ batchId: batch.id, dryRun, calendarId }), dryRun ? "Calendar checked" : "Events synced", dryRun ? "check" : "sync");
    if (r) setResult({ r: r.data, dryRun });
  };

  return (
    <Section
      title="Google Calendar"
      help="The batch's events come from this calendar: every event in the batch's dates, updated as soon as the calendar changes. Their name, times, location, description and video call are then changed in Google Calendar only. Share the calendar with the Hub's account (See all event details), then paste its ID: Google Calendar, the calendar's settings, Integrate calendar."
    >
      <Stack gap="xs">
        <TextInput label="Calendar ID" placeholder="…@group.calendar.google.com" value={input} onChange={(e) => onChange(e.currentTarget.value)} />
        {isSaved && <CalendarSyncStatus batchId={batch.id} />}
        {result && (
          <Text size="sm">
            {syncLine(result.r, result.dryRun)}
            {result.dryRun && ` Shared with ${result.r.serviceAccountEmail}.`}
          </Text>
        )}
        <Group gap="xs">
          <Button variant="default" disabled={!calendarId || isBusy} loading={busy === "check"} onClick={() => void go(true)}>
            Check
          </Button>
          {isSaved && (
            <Button variant="default" disabled={isBusy} loading={busy === "sync"} onClick={() => void go(false)}>
              Sync now
            </Button>
          )}
        </Group>
      </Stack>
    </Section>
  );
}

/**
 * Les scores du batch (SPECS §5.5) : recalcules chaque nuit et a la publication
 * d'un classement ; ce bouton les recalcule tout de suite. Un batch dont les
 * scores viennent d'un ancien outil (Spring 2026) n'est jamais recalcule.
 */
function ScoresSection({ batch }: { batch: WithId<Batch> }) {
  const { isBusy, run } = useAction();
  if (batch.settings.scoresSource === "imported") {
    return (
      <Section title="Scores">
        <Text size="sm" c="dimmed">
          This batch&apos;s scores were imported from a former tool. They are not recomputed.
        </Text>
      </Section>
    );
  }
  const recompute = () => void run(() => call("recomputeBatchScores")({ batchId: batch.id }), "Scores recomputed");
  return (
    <Section title="Scores" help="Program Performance, startup scores, attendance and network. Recomputed every night at 2:00 and when a ranking is published.">
      <Group>
        <Button size="md" variant="default" loading={isBusy} onClick={recompute}>
          Recompute scores
        </Button>
      </Group>
    </Section>
  );
}
