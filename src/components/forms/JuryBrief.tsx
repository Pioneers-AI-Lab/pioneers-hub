"use client";

import { Button, Group, Stack, Text } from "@mantine/core";
import type { JuryBrief as Brief, PublicChoice } from "@shared/callables";
import { metricValue } from "@/lib/format";
import { ExternalLink, Field } from "@/components/ui/Field";
import { Empty, SubsectionTitle } from "@/components/ui/Section";

// ----------------------------
// Ce que le jure lit avant de noter une equipe (SPECS §2.0)
// ----------------------------
// La Submission de l'equipe (information libre : la grille fait la note), puis
// les chiffres declares de toutes les equipes qu'il note, pour appliquer
// « 5 = la meilleure equipe » sur un critere chiffre. Rendu par le serveur
// (`getPublicForm`, lien de jury), jamais pour sa propre equipe.

export function JuryBrief({ brief, targets, targetId }: { brief: Brief; targets: PublicChoice[]; targetId: string }) {
  const submission = brief.submissions[targetId];
  // Un pitch (lot 5) : le Pitch deck de la startup, rempli avant le pitch.
  const isDeck = brief.source === "pitch_deck";

  return (
    <Stack gap="md" py="xs">
      <SubsectionTitle>{isDeck ? "Pitch deck" : "Submission"}</SubsectionTitle>
      {!submission ? (
        <Empty>{isDeck ? "No pitch deck yet." : "No submission yet."}</Empty>
      ) : (
        <>
          {submission.late && (
            <Text size="sm" c="orange">
              Sent after the deadline: it scores 0.
            </Text>
          )}
          {submission.driveFolderUrl && (
            <Button component="a" href={submission.driveFolderUrl} target="_blank" rel="noreferrer" variant="light" size="md" fullWidth maw={400}>
              Open the Drive folder
            </Button>
          )}
          {submission.answers.map((a) => (
            <Field key={a.label} label={a.label}>
              {a.urls.length > 0 ? (
                <Stack gap={4}>
                  {a.urls.map((url) => (
                    <ExternalLink key={url} href={url} />
                  ))}
                </Stack>
              ) : (
                a.text
              )}
            </Field>
          ))}
        </>
      )}
      {brief.metrics.length > 0 && (
        <>
          <SubsectionTitle>Declared numbers, all teams</SubsectionTitle>
          <Text size="sm" c="dimmed">
            On a numbers criterion, 5 = the best team.
          </Text>
          {brief.metrics.map((m) => {
            const value = (id: string) => brief.submissions[id]?.metrics[m.key];
            const ranked = [...targets].sort((a, b) => (value(b.value) ?? -Infinity) - (value(a.value) ?? -Infinity));
            return (
              <Stack key={m.key} gap={4}>
                <span className="label">{m.label}</span>
                {ranked.map((t) => {
                  const v = value(t.value);
                  const isCurrent = t.value === targetId;
                  return (
                    <Group key={t.value} justify="space-between" gap="sm" wrap="nowrap">
                      <Text size="sm" fw={isCurrent ? 600 : undefined} c={isCurrent ? "pioneers" : undefined} truncate>
                        {t.label}
                        {brief.submissions[t.value]?.late && (
                          <Text span size="sm" c="orange">
                            {" · late"}
                          </Text>
                        )}
                      </Text>
                      <Text size="sm" className="num" fw={isCurrent ? 600 : undefined} c={isCurrent ? "pioneers" : v === undefined ? "dimmed" : undefined}>
                        {v === undefined ? "-" : metricValue(m, v)}
                      </Text>
                    </Group>
                  );
                })}
              </Stack>
            );
          })}
        </>
      )}
    </Stack>
  );
}
