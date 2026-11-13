"use client";

import { useState } from "react";
import { Button, NumberInput, Stack, TextInput, Textarea } from "@mantine/core";
import { normalizeHttpUrl } from "@shared/text";
import type { EventMetric, Submission, WithId } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useAction } from "@/hooks/useAction";
import { saveTeamResults } from "@/lib/resultsAdmin";
import { Section } from "@/components/ui/Section";

// ----------------------------
// Les resultats d'une equipe, corriges par le staff
// ----------------------------
// Les memes champs que le Debrief (les metriques sont ses questions, SPECS §2) ;
// une valeur saisie ici est marquee `staff`. A monter avec une `key` tiree de
// l'enregistrement : il repart alors des valeurs de la base.

type Props = { eventId: string; teamId: string; metrics: EventMetric[]; current: WithId<Submission> | null; hint: string };

export function StaffTeamResults({ eventId, teamId, metrics: declared, current, hint }: Props) {
  const { firebaseUser } = useAuth();
  const [metrics, setMetrics] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(declared.map((m) => [m.key, current?.metrics?.[m.key] ?? null])),
  );
  const [productUrl, setProductUrl] = useState(current?.productUrl ?? "");
  const [proofs, setProofs] = useState((current?.proofUrls ?? []).join("\n"));
  const [notes, setNotes] = useState(current?.notes ?? "");
  const { isBusy, run } = useAction();

  const save = () =>
    void run(
      () =>
        saveTeamResults(
          eventId,
          teamId,
          current,
          {
            // Les metriques d'autres questions (formulaire modifie depuis) sont gardees.
            metrics: {
              ...current?.metrics,
              ...Object.fromEntries(Object.entries(metrics).filter((e): e is [string, number] => e[1] !== null)),
            },
            productUrl: normalizeHttpUrl(productUrl.trim()) ?? null,
            proofUrls: proofs.split(/\s+/).flatMap((u) => normalizeHttpUrl(u) ?? []),
            notes: notes.trim() || null,
          },
          firebaseUser?.uid ?? "",
        ),
      "Team results saved",
    );

  return (
    <Section title="Results" hint={hint}>
      <Stack gap="sm" maw={480}>
        {declared.map((m) => (
          <NumberInput
            key={m.key}
            label={m.label}
            min={0}
            value={metrics[m.key] ?? ""}
            onChange={(v) => setMetrics((x) => ({ ...x, [m.key]: typeof v === "number" ? v : null }))}
          />
        ))}
        <TextInput label="Product link" inputMode="url" placeholder="https://" value={productUrl} onChange={(e) => setProductUrl(e.currentTarget.value)} />
        <Textarea label="Proof links" description="One link per line." autosize minRows={2} value={proofs} onChange={(e) => setProofs(e.currentTarget.value)} />
        <Textarea label="Notes" autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        <Button size="md" fullWidth loading={isBusy} onClick={save}>
          Save results
        </Button>
      </Stack>
    </Section>
  );
}
