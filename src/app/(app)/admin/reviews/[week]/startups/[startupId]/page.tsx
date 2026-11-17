"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Group, SegmentedControl, Stack, Switch, Text, Textarea } from "@mantine/core";
import { OUTSTANDING_BONUS_POINTS } from "@shared/scoringRules";
import { CHECKIN_METRICS, STANDARD_METRICS } from "@shared/presets/standardMetrics";
import {
  STARTUP_REVIEW_CRITERIA,
  WEEKLY_REVIEW_MAX_NOTE,
  canStartupReviewBeOutstanding,
  startupReviewNote,
  startupReviewProblems,
  type StartupReviewScores,
} from "@shared/weeklyReviews";
import type { Checkin, WithId } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useAdmin } from "@/context/AdminContext";
import { useAdminReviews, type StartupReviewRow } from "@/context/AdminReviewsContext";
import { useAction } from "@/hooks/useAction";
import { useParamsTS } from "@/hooks/useParamsTS";
import { formatDateTime, metricValue } from "@/lib/format";
import { paths } from "@/lib/paths";
import { nextReviewHref, saveLabel, saveStartupReview, weekLabel } from "@/lib/reviewsAdmin";
import { ActionBar } from "@/components/admin/ActionBar";
import { BlockedState } from "@/components/ui/BlockedState";
import { Field, FieldGrid } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { Section } from "@/components/ui/Section";
import { WithHelp } from "@/components/ui/Help";

// ----------------------------
// Admin > Reviews > un Weekly update startup : l'update, puis la grille (lot 4)
// ----------------------------
// Traction (60 points) et Progress (40), de 0 a 5 : chaque critere rapporte note ÷ 5 × ses points ;
// l'Outstanding (+20) seulement a 100 (shared/weeklyReviews.ts). A cote : les objectifs de la
// semaine d'avant, pour juger le Progress. Normalement une update par startup ; si plusieurs
// membres l'ont envoyee, chacune s'affiche (la plus recente d'abord).

const NOTES = Array.from({ length: WEEKLY_REVIEW_MAX_NOTE + 1 }, (_, i) => String(i));

export default function AdminReviewStartupPage() {
  const { week, startupId } = useParamsTS<{ week: string; startupId: string }>();
  const { rowsOf, isLoading } = useAdminReviews();
  if (isLoading) return <PageLoader />;
  const rows = rowsOf(week);
  const row = rows.startups.find((r) => r.startup.id === startupId);
  if (!row) return <BlockedState reason="not_found" backHref={paths.adminReviewsWeek(week)} />;
  const next = nextReviewHref(week, rows, { startupId });
  return <StartupReviewGrid key={startupId} week={week} row={row} nextHref={next} />;
}

function UpdateFields({ update, author }: { update: WithId<Checkin>; author: string | null }) {
  const numbers = CHECKIN_METRICS.filter((k) => typeof update[k] === "number");
  return (
    <Stack gap="md">
      {author && (
        <Text size="sm" c="dimmed">
          Sent by {author}, {formatDateTime(update.updatedDateISOString)}
        </Text>
      )}
      <Field label="What did you achieve this week?" showEmpty>
        {update.achievement}
      </Field>
      <Field label="Goals for next week" showEmpty>
        {update.goals}
      </Field>
      {numbers.length > 0 && (
        <FieldGrid>
          {numbers.map((k) => (
            <Field key={k} label={STANDARD_METRICS[k].label}>
              {metricValue(STANDARD_METRICS[k], update[k] as number)}
            </Field>
          ))}
        </FieldGrid>
      )}
      <Field label="Biggest obstacle">{update.obstacle}</Field>
      <Field label="What did you learn?">{update.learned}</Field>
      <Field label="How can the staff help?">{update.helpNeeded}</Field>
    </Stack>
  );
}

function StartupReviewGrid({ week, row, nextHref }: { week: string; row: StartupReviewRow; nextHref: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { batch, foundersById } = useAdmin();
  const { busy, run } = useAction();
  const { startup, review } = row;
  const [scores, setScores] = useState<StartupReviewScores>(() => ({ ...review?.scores }));
  const [outstanding, setOutstanding] = useState(review?.outstanding === true);
  const [comment, setComment] = useState(review?.comment ?? "");

  const allowed = canStartupReviewBeOutstanding(scores);
  const isOutstanding = outstanding && allowed;
  const problem = startupReviewProblems(scores, isOutstanding)[0] ?? null;
  const note = startupReviewNote({ scores, outstanding: isOutstanding });

  const save = async () => {
    if (!user || problem) return;
    const input = { programId: batch.programId, batchId: batch.id, startupId: startup.id, weekStartDayString: week, scores, outstanding: isOutstanding, comment };
    const ok = await run(async () => (await saveStartupReview(input, user.id), true), `${startup.name}: review saved.`);
    if (ok) router.push(nextHref);
  };

  return (
    <>
      <PageHeader
        back={{ href: paths.adminReviewsWeek(week), label: weekLabel(week) }}
        title={startup.name}
        subtitle={review ? `Reviewed ${formatDateTime(review.reviewedDateISOString)}` : "Not reviewed yet."}
      />

      <Section title="Goals given last week">
        <Text size="sm" c={row.previousGoals ? undefined : "dimmed"} style={{ whiteSpace: "pre-line" }}>
          {row.previousGoals ?? "No update last week."}
        </Text>
      </Section>

      <Section title={row.updates.length > 1 ? `Updates · ${row.updates.length}` : "Update"}>
        {row.updates.map((u) => (
          <UpdateFields key={u.id} update={u} author={row.updates.length > 1 ? (foundersById.get(u.founderId)?.name ?? u.founderId) : null} />
        ))}
      </Section>

      <Section title="Grid" help={`Each criterion from 0 to ${WEEKLY_REVIEW_MAX_NOTE}: it earns score ÷ ${WEEKLY_REVIEW_MAX_NOTE} × its points.`}>
        {STARTUP_REVIEW_CRITERIA.map((c) => (
          <Stack key={c.key} gap="xs">
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text fw={500}>{c.label}</Text>
              <Text size="sm" c="dimmed" className="num">
                {c.points} points
              </Text>
            </Group>
            <Text size="sm" c="dimmed">
              {c.definition}
            </Text>
            <SegmentedControl
              fullWidth
              data={NOTES}
              value={scores[c.key] == null ? "" : String(scores[c.key])}
              onChange={(v) => setScores((prev) => ({ ...prev, [c.key]: Number(v) }))}
            />
          </Stack>
        ))}
        <WithHelp
          label={`Outstanding mention (+${OUTSTANDING_BONUS_POINTS})`}
          help="Only for an exceptional week."
          note={allowed ? undefined : "Only at 100: both criteria at 5."}
        >
          {(field) => (
            <Switch size="md" {...field} checked={isOutstanding} disabled={!allowed} onChange={(e) => setOutstanding(e.currentTarget.checked)} />
          )}
        </WithHelp>
        <Textarea label="Comment" autosize minRows={2} value={comment} onChange={(e) => setComment(e.currentTarget.value)} />
        <Text fw={500} className="num">
          {note === null ? "Not scored yet" : `Weekly note: ${note}${isOutstanding ? " (100 + Outstanding)" : " / 100"}`}
        </Text>
      </Section>

      <ActionBar label={saveLabel(week, nextHref)} problem={problem} loading={busy !== null} disabled={problem !== null || busy !== null} onClick={() => void save()} />
    </>
  );
}
