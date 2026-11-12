"use client";

import { useState } from "react";
import { Box, Button, Group, NumberInput, SegmentedControl, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { DEBRIEF_LIMITS, PEER_QUESTION, type ChallengeTask } from "@shared/callables";
import type { SubmissionLink } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useChallengeTasks } from "@/context/ChallengeTasksContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useAction } from "@/hooks/useAction";
import { useParamsTS } from "@/hooks/useParamsTS";
import { call } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { Row } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Debrief d'un hackathon (SPECS §4.2, §4.3)
// ----------------------------
// Deux saisies independantes, chacune avec son bouton :
//   - les resultats de l'equipe (un membre suffit ; le dernier enregistrement fait foi) ;
//   - l'avis du fondateur sur chaque coequipier, prive (seul le staff le lit).

const RATING_DATA = ["1", "2", "3", "4", "5"];

/** Enregistre, notifie, puis recharge le Debrief (les valeurs repartent du serveur). */
function useSave(action: () => Promise<unknown>, success: string) {
  const { reload } = useChallengeTasks();
  const { isBusy, run } = useAction();
  const save = async () => {
    if ((await run(action, success)) !== undefined) reload();
  };
  return { isSaving: isBusy, save };
}

export default function DebriefPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { eventId } = useParamsTS<{ eventId: string }>();
  const { tasks, isLoading, error } = useChallengeTasks();
  const back = { href: paths.todo(program.id, batch.id), label: "To do" };

  if (isLoading) return <PageLoader />;
  const task = tasks.find((t) => t.eventId === eventId);
  if (!task) {
    return (
      <>
        <PageHeader back={back} title="Debrief" />
        <Empty>{error ?? "You were not in a team at this hackathon, or teams are not published yet."}</Empty>
      </>
    );
  }
  return (
    <>
      <PageHeader back={back} title={task.eventName} subtitle={`${task.team.name} · ${formatDateTime(task.startDateISOString)}`} />
      {/* `key` : un rechargement apres enregistrement repart des valeurs du serveur. */}
      <TeamResultsForm key={JSON.stringify(task.results)} task={task} />
      <PeerRatingsForm key={JSON.stringify(task.myRatings)} task={task} />
    </>
  );
}

function TeamResultsForm({ task }: { task: ChallengeTask }) {
  const initial = task.results;
  const [metrics, setMetrics] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(task.metrics.map((m) => [m.key, initial?.metrics[m.key] ?? null])),
  );
  const [productUrl, setProductUrl] = useState(initial?.productUrl ?? "");
  const [links, setLinks] = useState<SubmissionLink[]>(initial?.links ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const { isSaving, save } = useSave(
    () =>
      call("submitTeamResults")({
        eventId: task.eventId,
        teamId: task.team.id,
        metrics: Object.fromEntries(Object.entries(metrics).filter((e): e is [string, number] => e[1] !== null)),
        links: links.filter((l) => l.url.trim()),
        productUrl: productUrl.trim() || null,
        notes: notes.trim() || null,
      }),
    "Team results saved",
  );

  const setLink = (i: number, patch: Partial<SubmissionLink>) =>
    setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Section title="Your team's results" hint="One teammate can fill this in for the whole team. The last save counts.">
      <Stack gap="sm">
        {task.metrics.map((m) => (
          <NumberInput
            key={m.key}
            label={m.unit ? `${m.label} (${m.unit})` : m.label}
            min={0}
            allowNegative={false}
            thousandSeparator=" "
            value={metrics[m.key] ?? ""}
            onChange={(v) => setMetrics((ms) => ({ ...ms, [m.key]: typeof v === "number" ? v : null }))}
          />
        ))}
        <TextInput label="Product" placeholder="https://" value={productUrl} onChange={(e) => setProductUrl(e.currentTarget.value)} />
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Proof
          </Text>
          <Text size="sm" c="dimmed">
            Screenshots, posts, a dashboard: anything that backs the numbers.
          </Text>
          {links.map((l, i) => (
            <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
              <TextInput
                aria-label={`Link ${i + 1} label`}
                placeholder="Label"
                maxLength={DEBRIEF_LIMITS.linkLabel}
                value={l.label}
                onChange={(e) => setLink(i, { label: e.currentTarget.value })}
                w="35%"
              />
              <TextInput
                aria-label={`Link ${i + 1} address`}
                placeholder="https://"
                value={l.url}
                onChange={(e) => setLink(i, { url: e.currentTarget.value })}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button variant="subtle" color="gray" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </Group>
          ))}
          {links.length < DEBRIEF_LIMITS.resultLinks && (
            <Button variant="default" w="fit-content" onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}>
              Add a link
            </Button>
          )}
        </Stack>
        <Textarea
          label="Notes"
          description="Anything the numbers do not say: who your customers were, what worked."
          autosize
          minRows={3}
          maxLength={DEBRIEF_LIMITS.resultNotes}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
        <Box mt="xs" maw={400}>
          <Button size="md" fullWidth loading={isSaving} onClick={save}>
            Save team results
          </Button>
        </Box>
      </Stack>
    </Section>
  );
}

type RatingDraft = { rating: number | null; comment: string };

function PeerRatingsForm({ task }: { task: ChallengeTask }) {
  const { foundersById } = useFounders();
  const mateIds = task.team.teammateIds;
  const [draft, setDraft] = useState<Record<string, RatingDraft>>(() =>
    Object.fromEntries(
      mateIds.map((id) => {
        const given = task.myRatings[id];
        return [id, { rating: given?.rating ?? null, comment: given?.comment ?? "" }];
      }),
    ),
  );
  const ratings = Object.entries(draft).flatMap(([rateeFounderId, d]) =>
    d.rating === null ? [] : [{ rateeFounderId, rating: d.rating, comment: d.comment.trim() || null }],
  );
  const { isSaving, save } = useSave(() => call("submitPeerRatings")({ eventId: task.eventId, ratings }), "Ratings saved");

  if (mateIds.length === 0) return null;
  const patch = (id: string, p: Partial<RatingDraft>) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...p } }));

  return (
    <Section title="Your teammates" hint={`${PEER_QUESTION} 1 = no, 5 = without hesitation. Private: only the Pioneers team reads it.`}>
      <Stack gap="lg">
        {mateIds.map((id) => {
          const mate = foundersById.get(id);
          const name = mate?.name ?? id;
          return (
            <Stack key={id} gap={6}>
              <Row title={name} avatar={{ name, photoUrl: mate?.photoUrl }} />
              <SegmentedControl
                fullWidth
                aria-label={`${PEER_QUESTION} ${name}`}
                data={RATING_DATA}
                value={String(draft[id].rating ?? "")}
                onChange={(v) => patch(id, { rating: Number(v) })}
              />
              <TextInput
                aria-label={`One line on ${name}`}
                placeholder="One line (optional)"
                maxLength={DEBRIEF_LIMITS.peerComment}
                value={draft[id].comment}
                onChange={(e) => patch(id, { comment: e.currentTarget.value })}
              />
            </Stack>
          );
        })}
        <Box mt="xs" maw={400}>
          <Button size="md" fullWidth loading={isSaving} disabled={ratings.length === 0} onClick={save}>
            Save ratings
          </Button>
        </Box>
      </Stack>
    </Section>
  );
}
