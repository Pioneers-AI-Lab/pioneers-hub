"use client";

import { useState } from "react";
import { Button, Group, NumberInput, SegmentedControl, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { criterionQuestion, metricQuestion } from "@shared/presets/formTemplates";
import { standardEventMetricKey } from "@shared/presets/standardMetrics";
import { scoringMaxTotal, variableExists } from "@shared/scoringRules";
import { keyFromLabel } from "@shared/text";
import { scoringOf, type ScoringItem, type ScoringItemInput } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { useAction } from "@/hooks/useAction";
import { call } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { appendQuestion } from "@/lib/formsAdmin";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";

// ----------------------------
// Le leaderboard d'un evenement : son bareme, ou les notes du jury
// ----------------------------
// SPECS §4.2 : un bareme donne des points a des VARIABLES des formulaires de
// l'evenement (une metrique de la Submission, un critere du jury). Tout se regle
// ici : choisir une variable, ou en creer une (la question s'ajoute a la
// Submission ou au formulaire de jury), dire combien de points elle vaut, et si
// elle sert seulement a departager (dans l'ordre du bareme). Chaque enregistrement
// passe par `setEventScoring` (verifie, journalise, recalcule le classement).
// Sans bareme : les notes du jury, ou une metrique choisie.

const JURY = "__jury__";
const NEW = "__new__";

/** Ce qu'on renvoie d'un element deja stocke : tout sauf sa cle (le serveur la tire de sa variable). */
const toInput = ({ label, mode, sourceKey, pointsPerUnit, maxPoints, tieBreakOnly }: ScoringItem): ScoringItemInput => ({
  label,
  mode,
  sourceKey,
  pointsPerUnit,
  maxPoints,
  tieBreakOnly,
});

/** Le pourquoi des points d'un element, en clair. */
function scoringItemRule(item: ScoringItemInput): string {
  const rule =
    item.mode === "per_unit"
      ? `${item.pointsPerUnit ?? 1} pts each`
      : item.mode === "proportional"
        ? `best team gets ${item.maxPoints ?? 0}, others in proportion`
        : `jury${item.maxPoints ? `, out of ${item.maxPoints}` : ""}`;
  return item.tieBreakOnly ? `Tie-break · ${rule}` : rule;
}

export function LeaderboardSection() {
  const { event, metrics, criteria } = useAdminEvent();
  const { events } = useAdmin();
  const { isBusy, run } = useAction();
  const scoring = scoringOf(event);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const items = scoring?.items ?? [];
  const isPublished = event.leaderboardRevealDateISOString !== null;

  const save = (next: ScoringItemInput[], message: string) =>
    run(() => call("setEventScoring")({ eventId: event.id, scoring: { items: next } }), message).then((r) => r !== undefined);
  const publish = (on: boolean) =>
    void run(() => call("publishEventRanking")({ eventId: event.id, publish: on }), on ? "Ranking published" : "Ranking unpublished");
  const others = events.filter((e) => e.id !== event.id && scoringOf(e));

  if (!scoring && metrics.length === 0 && criteria.length === 0) return null;
  const total = scoring ? scoringMaxTotal(scoring, criteria) : null;
  const hint = !scoring
    ? "What ranks the teams: the jury's scores, or one number of the submission. Or give points to several variables."
    : isPublished
      ? `Published ${formatDateTime(event.leaderboardRevealDateISOString!)}: founders see the ranking. A change recomputes it.`
      : "Founders see the ranking once you publish it, after checking the proofs. A late submission scores 0.";

  return (
    <Section title={scoring ? `Leaderboard · ${total === null ? "open total" : `out of ${total}`}` : "Leaderboard"} hint={hint}>
      {!scoring && <RankingControl />}
      <RowList>
        {items.map((item, i) => {
          const missing = !variableExists(item, metrics, criteria);
          return (
            <ButtonRow
              key={item.key}
              onClick={() => setEditing(i)}
              title={item.label}
              subtitle={missing ? <Text span c="orange" inherit>No question writes this variable anymore</Text> : scoringItemRule(item)}
            />
          );
        })}
        <ButtonRow onClick={() => setEditing("new")} title={scoring ? "Add an item" : "Score with points instead"} subtitle={scoring ? undefined : "Points per variable, tie-breaks"} />
      </RowList>
      <Group mt="sm" gap="sm">
        {scoring && (
          <Button size="md" loading={isBusy} variant={isPublished ? "default" : "filled"} onClick={() => publish(!isPublished)}>
            {isPublished ? "Unpublish ranking" : "Publish ranking"}
          </Button>
        )}
        {others.length > 0 && (
          <Select
            maw={280}
            placeholder="Copy scoring from..."
            data={others.map((e) => ({ value: e.id, label: e.name }))}
            value={null}
            disabled={isBusy}
            onChange={(id) => {
              const from = others.find((e) => e.id === id);
              if (from) void save(scoringOf(from)!.items.map(toInput), `Scoring copied from ${from.name}`);
            }}
          />
        )}
      </Group>
      {editing !== null && (
        <ItemSheet
          index={editing === "new" ? null : editing}
          items={items}
          isSaving={isBusy}
          onClose={() => setEditing(null)}
          onSave={async (next, message) => {
            if (await save(next, message)) setEditing(null);
          }}
        />
      )}
    </Section>
  );
}

/** Sans bareme : les notes du jury, ou une metrique de la Submission. */
function RankingControl() {
  const { event, metrics } = useAdminEvent();
  const { isBusy, run } = useAction();
  const value = event.rankingMetricKey ?? JURY;
  const change = (next: string | null) => {
    if (!next || next === value) return;
    void run(() => call("setEventRanking")({ eventId: event.id, metricKey: next === JURY ? null : next }), "Leaderboard updated");
  };
  const options = [{ value: JURY, label: "Jury scores" }, ...metrics.map((m) => ({ value: m.key, label: m.label }))];
  return options.length <= 3 ? (
    <SegmentedControl fullWidth maw={480} mb="sm" data={options} value={value} onChange={change} disabled={isBusy} />
  ) : (
    <Select maw={480} mb="sm" data={options} value={value} onChange={change} disabled={isBusy} allowDeselect={false} />
  );
}

type ItemSheetProps = {
  /** L'element modifie, `null` pour un nouvel element. */
  index: number | null;
  items: ScoringItem[];
  /** Un enregistrement du bareme est en cours (celui de la section). */
  isSaving: boolean;
  onClose: () => void;
  onSave: (items: ScoringItemInput[], message: string) => Promise<void>;
};

/** Un element du bareme : sa variable (existante ou nouvelle), ses points, departage ou non. */
function ItemSheet({ index, items, isSaving, onClose, onSave }: ItemSheetProps) {
  const { metrics, criteria, forms, juryForm } = useAdminEvent();
  const { isBusy: isAdding, run } = useAction();
  const isBusy = isSaving || isAdding;
  const item = index === null ? null : items[index];
  const [source, setSource] = useState<"metric" | "criterion">(item?.mode === "criterion" ? "criterion" : "metric");
  const [variable, setVariable] = useState<string | null>(item?.sourceKey ?? null);
  const [newLabel, setNewLabel] = useState("");
  const [newScaleMax, setNewScaleMax] = useState<number>(20);
  const [teamMode, setTeamMode] = useState<"per_unit" | "proportional">(item?.mode === "proportional" ? "proportional" : "per_unit");
  const [points, setPoints] = useState<number | null>(item ? (item.mode === "per_unit" ? (item.pointsPerUnit ?? null) : (item.maxPoints ?? null)) : null);
  const [tieBreakOnly, setTieBreakOnly] = useState(item?.tieBreakOnly === true);

  const submission = forms.find((f) => f.kind === "debrief") ?? null;
  const targetForm = source === "metric" ? submission : juryForm;
  const used = new Set(items.filter((_, i) => i !== index).map((i) => i.sourceKey));
  const known = source === "metric" ? metrics : criteria;
  const options = [
    ...known.filter((v) => !used.has(v.key)).map((v) => ({ value: v.key, label: `${v.label} (${v.key})` })),
    ...(targetForm ? [{ value: NEW, label: source === "metric" ? "New team number..." : "New jury criterion..." }] : []),
  ];
  const isNew = variable === NEW;
  // La cle standard d'abord (« Cold calls » -> `callsMade`) : une variable qui existe deja se choisit dans la liste.
  const newKey = newLabel.trim() ? (source === "metric" ? standardEventMetricKey(keyFromLabel(newLabel)) : keyFromLabel(newLabel)) : null;
  const newKeyTaken = newKey !== null && [...metrics, ...criteria].some((v) => v.key === newKey);
  const sourceKey = isNew ? (newKeyTaken ? null : newKey) : variable;
  const label = isNew ? newLabel.trim() : (known.find((v) => v.key === variable)?.label ?? item?.label ?? "");
  const scaleMax = isNew ? newScaleMax : (criteria.find((c) => c.key === variable)?.max ?? null);
  const mode = source === "criterion" ? "criterion" : teamMode;
  // Un critere vaut par defaut sa note telle quelle (son echelle).
  const effectivePoints = mode === "criterion" ? (points ?? scaleMax) : points;

  const draft: ScoringItemInput | null =
    sourceKey && label && (mode === "criterion" || (effectivePoints ?? 0) > 0)
      ? {
          label,
          mode,
          sourceKey,
          pointsPerUnit: mode === "per_unit" ? effectivePoints : null,
          maxPoints: mode === "per_unit" ? null : effectivePoints,
          ...(tieBreakOnly ? { tieBreakOnly: true } : {}),
        }
      : null;
  const preview = !draft
    ? null
    : mode === "per_unit"
      ? `A team with 3 ${label.toLowerCase()} gets ${3 * (effectivePoints ?? 0)} pts.`
      : mode === "proportional"
        ? `The best team gets ${effectivePoints} pts; a team with half its number gets ${(effectivePoints ?? 0) / 2}.`
        : `A jury average of ${(scaleMax ?? 0) / 2} out of ${scaleMax} gives ${(effectivePoints ?? 0) / 2} pts.`;

  const list = items.map(toInput);
  const submit = async () => {
    if (!draft) return;
    // Une nouvelle variable : sa question s'ajoute d'abord au formulaire (nouvelle version s'il est publie).
    if (isNew && targetForm) {
      const question =
        source === "metric"
          ? metricQuestion({ key: draft.sourceKey, label, unit: null })
          : criterionQuestion({ key: draft.sourceKey, label, min: 0, max: newScaleMax, weight: 1 });
      const added = await run(() => appendQuestion(targetForm, question), `${label} added to the ${source === "metric" ? "submission" : "jury form"}`);
      if (added === undefined) return;
    }
    const next = index === null ? [...list, draft] : list.map((x, i) => (i === index ? draft : x));
    await onSave(next, index === null ? "Item added" : "Item saved");
  };
  const move = (delta: -1 | 1) => {
    if (index === null) return;
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    void onSave(next, "Order saved");
  };

  return (
    <ResponsiveDialog opened onClose={onClose} title={item ? item.label : "New item"}>
      <Stack gap="md">
        <SegmentedControl
          fullWidth
          data={[
            { value: "metric", label: "Team number" },
            { value: "criterion", label: "Jury score" },
          ]}
          value={source}
          onChange={(v) => {
            setSource(v as "metric" | "criterion");
            setVariable(null);
            setPoints(null);
          }}
        />
        <Select
          label="Variable"
          placeholder={targetForm ? "Choose" : undefined}
          description={targetForm ? undefined : `Create the event's ${source === "metric" ? "submission" : "jury form"} first (Forms above).`}
          data={options}
          value={variable}
          onChange={setVariable}
          allowDeselect={false}
        />
        {isNew && (
          <Group grow align="flex-start">
            <TextInput
              label={source === "metric" ? "Question" : "Criterion"}
              description={newKey && !newKeyTaken ? `Key: ${newKey}` : undefined}
              error={newKeyTaken ? `\`${newKey}\` already exists: choose it in the list.` : undefined}
              value={newLabel}
              onChange={(e) => setNewLabel(e.currentTarget.value)}
            />
            {source === "criterion" && <NumberInput label="Scored out of" min={1} max={100} value={newScaleMax} onChange={(v) => setNewScaleMax(typeof v === "number" ? v : 20)} />}
          </Group>
        )}
        {source === "metric" && (
          <SegmentedControl
            fullWidth
            data={[
              { value: "per_unit", label: "Per unit" },
              { value: "proportional", label: "Best team gets" },
            ]}
            value={teamMode}
            onChange={(v) => setTeamMode(v as "per_unit" | "proportional")}
          />
        )}
        <NumberInput
          label={mode === "per_unit" ? "Points per unit" : mode === "proportional" ? "Points of the best team" : "Points"}
          description={mode === "criterion" ? "Empty: the jury's score as it is." : undefined}
          min={0}
          value={points ?? ""}
          onChange={(v) => setPoints(typeof v === "number" ? v : null)}
        />
        <Switch label="Tie-break only" description="It does not count in the total; it separates equal totals, in the order of the list." checked={tieBreakOnly} onChange={(e) => setTieBreakOnly(e.currentTarget.checked)} />
        {preview && (
          <Text size="sm" c="dimmed">
            {preview}
          </Text>
        )}
        <Button size="md" fullWidth loading={isBusy} disabled={!draft} onClick={() => void submit()}>
          Save
        </Button>
        {index !== null && (
          <Group justify="space-between">
            <Group gap="xs">
              <Button variant="default" disabled={isBusy || index === 0} onClick={() => move(-1)}>
                Move up
              </Button>
              <Button variant="default" disabled={isBusy || index === items.length - 1} onClick={() => move(1)}>
                Move down
              </Button>
            </Group>
            <Button variant="subtle" color="red" disabled={isBusy} onClick={() => void onSave(list.filter((_, i) => i !== index), "Item removed")}>
              Remove
            </Button>
          </Group>
        )}
      </Stack>
    </ResponsiveDialog>
  );
}

