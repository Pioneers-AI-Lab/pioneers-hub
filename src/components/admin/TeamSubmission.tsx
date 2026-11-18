"use client";

import { Stack, Text } from "@mantine/core";
import { PROBLEM_SOURCE_LABELS, type Submission } from "@shared/types";
import { ExternalLink, Field } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";

// ----------------------------
// La Submission d'une equipe et son retard (SPECS §4.2)
// ----------------------------
// Ce que l'equipe a envoye (textes, dossier Drive) et son retard. Depuis le 17/11, le
// jury juge lui-meme les preuves en ouvrant le Drive : plus d'element « mis a 0 »
// (les anciens restent lus par le bareme). Le classement suit (`onSubmissionWritten`).

export function TeamSubmission({ submission }: { submission: Submission }) {
  return (
    <Section title="Submission" help="What the team sent. The jury checks the proofs in the Drive folder when it scores.">
      <Stack gap="md" maw={480}>
        <Field label="Drive folder">{submission.driveFolderUrl ? <ExternalLink href={submission.driveFolderUrl} /> : null}</Field>
        <Field label="Pain in one sentence">{submission.painSentence}</Field>
        <Field label="Problem">{submission.problemSource ? PROBLEM_SOURCE_LABELS[submission.problemSource] : null}</Field>
        <Field label="What they learned">{submission.learnings}</Field>
        {/* Le H5 : Plan (texte et lien), puis Snapshot (produit, demo, fonctionnalites). */}
        <Field label="Plan or team notes">{submission.notes}</Field>
        <Field label="Plan link">{submission.slideUrl ? <ExternalLink href={submission.slideUrl} /> : null}</Field>
        <Field label="Product">{submission.productUrl ? <ExternalLink href={submission.productUrl} /> : null}</Field>
        <Field label="Demo">{submission.videoUrl ? <ExternalLink href={submission.videoUrl} /> : null}</Field>
        <Field label="Features shipped">{submission.features}</Field>
        {submission.late && (
          <Text size="sm" c="orange">
            Sent after the deadline.
          </Text>
        )}
      </Stack>
    </Section>
  );
}
