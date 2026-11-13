"use client";

import { Stack, Switch, Text } from "@mantine/core";
import { PROBLEM_SOURCE_LABELS, type EventScoring, type Submission, type WithId } from "@shared/types";
import { useAction } from "@/hooks/useAction";
import { setTeamProofCheck } from "@/lib/resultsAdmin";
import { ExternalLink, Field } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";

// ----------------------------
// La verification des preuves d'une equipe (SPECS §4.2)
// ----------------------------
// Ce que l'equipe a envoye (textes, dossier Drive), puis les deux gestes du
// staff : lever un envoi en retard (le bareme lui donne 0 sinon), et mettre a 0
// un element du bareme quand une preuve est fausse. Chaque geste s'enregistre
// tout de suite ; le classement suit (declencheur `onSubmissionWritten`).

type Props = { eventId: string; teamId: string; scoring: EventScoring | null; submission: WithId<Submission> };

export function TeamProofCheck({ eventId, teamId, scoring, submission }: Props) {
  const { isBusy, run } = useAction();
  const zeroed = new Set(submission.zeroedItemKeys ?? []);
  const toggleZero = (key: string, on: boolean) => {
    const next = on ? [...zeroed, key] : [...zeroed].filter((k) => k !== key);
    void run(() => setTeamProofCheck(eventId, teamId, { zeroedItemKeys: next }), on ? "Item set to 0" : "Item counts again");
  };

  return (
    <Section title="Proof check" hint="Check 5 proofs at random in the team's Drive folder. One fake proof sets that item to 0.">
      <Stack gap="md" maw={480}>
        <Field label="Drive folder">{submission.driveFolderUrl ? <ExternalLink href={submission.driveFolderUrl} /> : null}</Field>
        <Field label="Pain in one sentence">{submission.painSentence}</Field>
        <Field label="Problem">{submission.problemSource ? PROBLEM_SOURCE_LABELS[submission.problemSource] : null}</Field>
        <Field label="What they learned">{submission.learnings}</Field>
        {submission.late && (
          <Stack gap={4}>
            <Text size="sm" c="orange">
              Sent after the deadline: it scores 0.
            </Text>
            <Switch
              label="Waive the late submission"
              checked={submission.lateWaived === true}
              disabled={isBusy}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                void run(() => setTeamProofCheck(eventId, teamId, { lateWaived: on }), on ? "Late submission waived" : "Late submission scores 0");
              }}
            />
          </Stack>
        )}
        {(scoring?.items ?? []).map((item) => (
          <Switch
            key={item.key}
            label={`Set ${item.label} to 0`}
            description={item.tieBreakOnly ? "Tie-break only" : undefined}
            checked={zeroed.has(item.key)}
            disabled={isBusy}
            onChange={(e) => toggleZero(item.key, e.currentTarget.checked)}
          />
        ))}
      </Stack>
    </Section>
  );
}
