"use client";

import { Stack, Switch, Text } from "@mantine/core";
import { PROBLEM_SOURCE_LABELS, type Submission, type WithId } from "@shared/types";
import { useAction } from "@/hooks/useAction";
import { setLateWaived } from "@/lib/resultsAdmin";
import { ExternalLink, Field } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";

// ----------------------------
// La Submission d'une equipe et son retard (SPECS §4.2)
// ----------------------------
// Ce que l'equipe a envoye (textes, dossier Drive), puis le geste du staff :
// lever un envoi en retard (le bareme lui donne 0 sinon). Depuis le 17/11, le
// jury juge lui-meme les preuves en ouvrant le Drive : plus d'element « mis a 0 »
// (les anciens restent lus par le bareme). Le classement suit (`onSubmissionWritten`).

type Props = { eventId: string; teamId: string; submission: WithId<Submission> };

export function TeamSubmission({ eventId, teamId, submission }: Props) {
  const { isBusy, run } = useAction();

  return (
    <Section title="Submission" hint="What the team sent. The jury checks the proofs in the Drive folder when it scores.">
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
                void run(() => setLateWaived(eventId, teamId, on), on ? "Late submission waived" : "Late submission scores 0");
              }}
            />
          </Stack>
        )}
      </Stack>
    </Section>
  );
}
