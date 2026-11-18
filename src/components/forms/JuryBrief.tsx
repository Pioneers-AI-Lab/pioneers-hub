"use client";

import { Button, Group, Stack, Text } from "@mantine/core";
import type { JuryAnswer, JuryBlock, JuryBrief as Brief, PublicChoice } from "@shared/callables";
import { briefMetricRanks, isBlankAnswer, rankLabel } from "@shared/juryBrief";
import type { EventMetric } from "@shared/types";
import { metricValue } from "@/lib/format";
import { ExternalLink, Field } from "@/components/ui/Field";
import { Empty, SubsectionTitle } from "@/components/ui/Section";

// ----------------------------
// Ce que le jure lit avant de noter une cible (SPECS §2.0 ; refonte du 18/11)
// ----------------------------
// Dans l'ordre : 1. QUI il note (l'equipe ou la startup, ses membres) ; 2. ses reponses, un bloc
// par formulaire de l'evenement (Submission, H5 Plan / Snapshot / Final numbers, Pitch deck),
// questions sans reponse comprises (« Not answered »), et le dossier Drive ; 3. les chiffres
// declares de toutes les cibles, avec leur place (« 5 = la meilleure equipe »). Sa grille suit
// (FormSheet), la place de la cible sous chaque critere chiffre (`MetricRankNote`). Rendu par le
// serveur (`getPublicForm`, lien de jury), jamais pour sa propre equipe.

/** La place de chaque cible notee sur un chiffre, parmi celles qui l'ont declare. */
const ranksOf = (brief: Brief, targets: PublicChoice[], metric: EventMetric) => briefMetricRanks(brief, targets.map((t) => t.value), metric.key);

function Answer({ a }: { a: JuryAnswer }) {
  return (
    <Field label={a.label} showEmpty>
      {isBlankAnswer(a) ? (
        <Text span size="sm" c="dimmed">
          Not answered
        </Text>
      ) : a.urls.length > 0 ? (
        <Stack gap={4}>
          {a.urls.map((url) => (
            <ExternalLink key={url} href={url} />
          ))}
        </Stack>
      ) : (
        a.text
      )}
    </Field>
  );
}

export function JuryBrief({ brief, targets, targetId }: { brief: Brief; targets: PublicChoice[]; targetId: string }) {
  const submission = brief.submissions[targetId];
  const target = targets.find((t) => t.value === targetId);
  // Un pitch (lot 5) : le Pitch deck de la startup, rempli avant le pitch.
  const isDeck = brief.source === "pitch_deck";
  // Un serveur d'avant le 18/11 n'a pas de blocs : un seul, la liste des reponses donnees.
  const blocks: JuryBlock[] =
    brief.blocks?.[targetId] ?? (submission ? [{ title: isDeck ? "Pitch deck" : "Submission", answers: submission.answers }] : []);
  const sentNothing = !submission && blocks.every((b) => b.answers.every(isBlankAnswer));

  return (
    <Stack gap="md" py="xs">
      {/* 1. Qui je note */}
      <Stack gap={2} className="card card-pad">
        <span className="label">{isDeck ? "You are scoring the startup" : "You are scoring the team"}</span>
        <Text fw={600} size="lg">
          {target?.label ?? targetId}
        </Text>
        {target?.hint && (
          <Text size="sm" c="dimmed">
            {target.hint}
          </Text>
        )}
      </Stack>

      {/* 2. Ses reponses */}
      {submission?.late && (
        <Text size="sm" c="orange">
          Sent after the deadline: it scores 0.
        </Text>
      )}
      {submission?.driveFolderUrl ? (
        <Button component="a" href={submission.driveFolderUrl} target="_blank" rel="noreferrer" variant="light" size="md" fullWidth maw={400}>
          Open the Drive folder
        </Button>
      ) : (
        brief.asksDriveFolder && !sentNothing && <Field label="Drive folder">No Drive folder shared.</Field>
      )}
      {sentNothing ? (
        <Empty>{isDeck ? "No pitch deck yet." : "No submission yet."}</Empty>
      ) : (
        blocks.map((b, i) => (
          <Stack key={i} gap="sm">
            <SubsectionTitle>{b.title}</SubsectionTitle>
            {b.answers.map((a, j) => (
              <Answer key={j} a={a} />
            ))}
          </Stack>
        ))
      )}

      {/* 3. Les chiffres de toutes les cibles, avec leur place */}
      {brief.metrics.length > 0 && (
        <>
          <SubsectionTitle>Declared numbers, all teams</SubsectionTitle>
          <Text size="sm" c="dimmed">
            On a numbers criterion, 5 = the best team.
          </Text>
          {brief.metrics.map((m) => {
            const ranks = ranksOf(brief, targets, m);
            const ranked = [...targets].sort((a, b) => (ranks.get(a.value)?.rank ?? Infinity) - (ranks.get(b.value)?.rank ?? Infinity));
            return (
              <Stack key={m.key} gap={4}>
                <span className="label">{m.label}</span>
                {ranked.map((t) => {
                  const r = ranks.get(t.value);
                  const isCurrent = t.value === targetId;
                  const tone = isCurrent ? "pioneers" : r === undefined ? "dimmed" : undefined;
                  return (
                    <Group key={t.value} justify="space-between" gap="sm" wrap="nowrap">
                      <Text size="sm" fw={isCurrent ? 600 : undefined} c={tone} truncate>
                        <Text span size="sm" className="num" c="dimmed">
                          {r ? `${r.rank}. ` : "–  "}
                        </Text>
                        {t.label}
                        {brief.submissions[t.value]?.late && (
                          <Text span size="sm" c="orange">
                            {" · late"}
                          </Text>
                        )}
                      </Text>
                      <Text size="sm" className="num" fw={isCurrent ? 600 : undefined} c={tone}>
                        {r ? metricValue(m, r.value) : "-"}
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

/**
 * Sous un critere qui note un chiffre declare (`brief.criterionMetrics`) : la valeur de la cible,
 * sa place et la meilleure valeur (« 66 · 2nd of 8 · best 80 »), pour noter « 5 = la meilleure ».
 */
export function MetricRankNote({ brief, targets, targetId, questionId }: { brief: Brief; targets: PublicChoice[]; targetId: string; questionId: string }) {
  const metric = brief.metrics.find((m) => m.key === brief.criterionMetrics?.[questionId]);
  if (!metric) return null;
  const r = ranksOf(brief, targets, metric).get(targetId);
  return (
    <Text size="sm" c="pioneers" className="num">
      {r
        ? `${metric.label}: ${metricValue(metric, r.value)} · ${rankLabel(r)} · best ${metricValue(metric, r.best)}`
        : `${metric.label}: not declared`}
    </Text>
  );
}
