"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SegmentedControl, Stack, Text, Textarea } from "@mantine/core";
import { FOUNDER_REVIEW_QUESTIONS, founderReviewProblems, type FounderReviewAnswers } from "@shared/weeklyReviews";
import { COMMITMENT_STATUS_LABELS, MATCH_RESULT_LABELS } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useAdmin } from "@/context/AdminContext";
import { useAdminReviews, type FounderReviewRow } from "@/context/AdminReviewsContext";
import { useAction } from "@/hooks/useAction";
import { useParamsTS } from "@/hooks/useParamsTS";
import { formatDateTime, integer, joinList } from "@/lib/format";
import { paths } from "@/lib/paths";
import { nextReviewHref, saveFounderReview, saveLabel, weekLabel } from "@/lib/reviewsAdmin";
import { ActionBar } from "@/components/admin/ActionBar";
import { BlockedState } from "@/components/ui/BlockedState";
import { Field, FieldGrid } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { Section } from "@/components/ui/Section";

// ----------------------------
// Admin > Reviews > un Weekly update founder : la reponse, puis la grille oui / non (lot 4)
// ----------------------------
// A cote de la reponse : l'objectif de la semaine d'avant (« atteint ? ») et la shortlist et les
// « Met » du fondateur, qu'on ne lui redemande pas (§2.8). Pas d'Outstanding : une milestone est
// atteinte ou non. Enregistrer passe a l'update suivant a revoir.

const CHOICES = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "", label: "Not judged" },
];
const toChoice = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "");
const fromChoice = (v: string) => (v === "yes" ? true : v === "no" ? false : null);

export default function AdminReviewFounderPage() {
  const { week, founderId } = useParamsTS<{ week: string; founderId: string }>();
  const { rowsOf, isLoading } = useAdminReviews();
  if (isLoading) return <PageLoader />;
  const rows = rowsOf(week);
  const row = rows.founders.find((r) => r.founder.id === founderId);
  if (!row) return <BlockedState reason="not_found" backHref={paths.adminReviewsWeek(week)} />;
  const next = nextReviewHref(week, rows, { founderId });
  // Une cle par fondateur : passer au suivant repart de SA revue.
  return <FounderReviewGrid key={founderId} week={week} row={row} nextHref={next} />;
}

function FounderReviewGrid({ week, row, nextHref }: { week: string; row: FounderReviewRow; nextHref: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { batch, foundersById } = useAdmin();
  const { busy, run } = useAction();
  const { founder, update: u, review } = row;
  const [answers, setAnswers] = useState<FounderReviewAnswers>(() => ({
    goalAmbitious: review?.goalAmbitious ?? null,
    goalReached: review?.goalReached ?? null,
    problemValidated: review?.problemValidated ?? null,
  }));
  const [comment, setComment] = useState(review?.comment ?? "");
  const problem = founderReviewProblems(answers)[0] ?? null;

  const save = async () => {
    if (!user || problem) return;
    const input = { programId: batch.programId, batchId: batch.id, founderId: founder.id, weekStartDayString: week, ...answers, comment };
    const ok = await run(async () => (await saveFounderReview(input, user.id), true), `${founder.name}: review saved.`);
    if (ok) router.push(nextHref);
  };

  return (
    <>
      <PageHeader
        back={{ href: paths.adminReviewsWeek(week), label: weekLabel(week) }}
        title={founder.name}
        subtitle={review ? `Reviewed ${formatDateTime(review.reviewedDateISOString)}` : "Not reviewed yet."}
      />

      <Section title="Update">
        <Stack gap="md">
          <Field label="Goal given last week" showEmpty>
            {row.previousGoal}
          </Field>
          <Field label="What did you achieve?" showEmpty>
            {u.achieved ?? null}
          </Field>
          <Field label="Goal for next week" showEmpty>
            {u.goalForWeek}
          </Field>
          <FieldGrid>
            <Field label="Where are you at?">{u.commitmentStatus ? COMMITMENT_STATUS_LABELS[u.commitmentStatus] : null}</Field>
            <Field label="Messages sent">{u.messagesSent != null ? integer(u.messagesSent) : null}</Field>
            <Field label="Conversations with potential users">{u.conversationsDone != null ? integer(u.conversationsDone) : null}</Field>
            <Field label="Co-founder matching">{u.matchResult ? MATCH_RESULT_LABELS[u.matchResult] : null}</Field>
          </FieldGrid>
          <Field label="What did you learn?">{u.learnings}</Field>
          <Field label="Active discussions">{joinList(u.workingWithFounderIds.map((id) => foundersById.get(id)?.name ?? id)) || null}</Field>
        </Stack>
      </Section>

      <Section title="Network" help="From the founder's own lists: not asked again in the update.">
        <FieldGrid>
          <Field label="Shortlisted" showEmpty>
            {integer(row.shortlistedCount)}
          </Field>
          <Field label="Met" showEmpty>
            {`${integer(row.metCount)} (${integer(row.reciprocalMetCount)} mutual)`}
          </Field>
        </FieldGrid>
      </Section>

      <Section title="Grid" help="Yes or no: they give the Weekly goal milestone (last week's goal judged ambitious, then reached) and the Problem validated milestone (reached once, stays reached).">
        {FOUNDER_REVIEW_QUESTIONS.map((q) => (
          <Stack key={q.key} gap="xs">
            <Text fw={500}>{q.label}</Text>
            <Text size="sm" c="dimmed">
              {q.hint}
            </Text>
            <SegmentedControl
              fullWidth
              data={CHOICES}
              value={toChoice(answers[q.key])}
              onChange={(v) => setAnswers((prev) => ({ ...prev, [q.key]: fromChoice(v) }))}
            />
          </Stack>
        ))}
        <Textarea label="Comment" autosize minRows={2} value={comment} onChange={(e) => setComment(e.currentTarget.value)} />
      </Section>

      <ActionBar label={saveLabel(week, nextHref)} problem={problem} loading={busy !== null} disabled={problem !== null || busy !== null} onClick={() => void save()} />
    </>
  );
}
