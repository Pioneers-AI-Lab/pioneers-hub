"use client";

import { useState } from "react";
import { Box, Button, NumberInput, SegmentedControl, Stack, Text, Textarea } from "@mantine/core";
import type { Criterion } from "@shared/types";
import { JUDGE_LIMITS } from "@shared/callables";
import { useJudgeSheet } from "@/context/JudgeSheetContext";
import { useAction } from "@/hooks/useAction";
import { call } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty } from "@/components/ui/Section";

// ----------------------------
// Feuille d'un jure : une ligne par equipe (ou startup), qui deplie la grille
// ----------------------------
// Toute la grille est obligatoire ; une cible se renote jusqu'au verrouillage.

/** Echelle courte (1 a 5, 0 a 10) : segments ; plus large : saisie. */
const asSegments = (c: Criterion) => c.max - c.min <= 10 && Number.isInteger(c.min) && Number.isInteger(c.max);

export default function JudgePage() {
  const { sheet } = useJudgeSheet();
  const [openId, setOpenId] = useState<string | null>(null);
  const done = sheet.targets.filter((t) => sheet.scores[t.id]).length;

  return (
    <>
      <PageHeader
        title={sheet.eventName}
        subtitle={`${sheet.judgeName} · ${formatDateTime(sheet.startDateISOString)} · ${done} of ${sheet.targets.length} scored`}
      />
      {!sheet.canEdit && <Empty>Scores are locked for this event. You can still read yours.</Empty>}
      {sheet.targets.length === 0 ? (
        <Empty>Nothing to score yet. Teams show up here once they are published.</Empty>
      ) : (
        <RowList>
          {sheet.targets.map((t) => (
            <Box key={t.id}>
              <ButtonRow
                onClick={() => setOpenId(openId === t.id ? null : t.id)}
                expanded={openId === t.id}
                title={t.name}
                subtitle={t.members.join(", ") || undefined}
                meta={sheet.scores[t.id] ? "Scored" : <Text size="sm" c="pioneers">To score</Text>}
              />
              {openId === t.id && <ScoreForm targetId={t.id} onSaved={() => setOpenId(null)} />}
            </Box>
          ))}
        </RowList>
      )}
    </>
  );
}

function ScoreForm({ targetId, onSaved }: { targetId: string; onSaved: () => void }) {
  const { sheet, judgeKey, reload } = useJudgeSheet();
  const given = sheet.scores[targetId];
  const [scores, setScores] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(sheet.criteria.map((c) => [c.key, given?.scores[c.key] ?? null])),
  );
  const [comment, setComment] = useState(given?.comment ?? "");
  const { isBusy, run } = useAction();
  const complete = sheet.criteria.every((c) => scores[c.key] !== null);

  // Le bouton n'est actif qu'une grille complete : toutes les notes sont des nombres.
  const save = async () => {
    const saved = await run(
      () => call("submitJudgeScores")({ ...judgeKey, targetId, scores: scores as Record<string, number>, comment: comment.trim() || null }),
      "Scores saved",
    );
    if (!saved) return;
    reload();
    onSaved();
  };

  return (
    <Stack gap="md" py="md">
      {sheet.criteria.map((c) => (
        <Stack key={c.key} gap={6}>
          <Text size="sm" fw={500}>
            {c.label}
            <Text span c="dimmed" size="sm">
              {` · ${c.min} to ${c.max}`}
            </Text>
          </Text>
          {asSegments(c) ? (
            <SegmentedControl
              fullWidth
              disabled={!sheet.canEdit}
              data={Array.from({ length: c.max - c.min + 1 }, (_, i) => String(c.min + i))}
              value={scores[c.key] === null ? "" : String(scores[c.key])}
              onChange={(v) => setScores((s) => ({ ...s, [c.key]: Number(v) }))}
            />
          ) : (
            <NumberInput
              aria-label={c.label}
              disabled={!sheet.canEdit}
              min={c.min}
              max={c.max}
              value={scores[c.key] ?? ""}
              onChange={(v) => setScores((s) => ({ ...s, [c.key]: typeof v === "number" ? v : null }))}
            />
          )}
        </Stack>
      ))}
      <Textarea
        label="Comment"
        description="Optional. Shared with the Pioneers team only."
        autosize
        minRows={2}
        maxLength={JUDGE_LIMITS.comment}
        disabled={!sheet.canEdit}
        value={comment}
        onChange={(e) => setComment(e.currentTarget.value)}
      />
      {sheet.canEdit && (
        <Button size="md" fullWidth maw={400} loading={isBusy} disabled={!complete} onClick={save}>
          Save scores
        </Button>
      )}
    </Stack>
  );
}
