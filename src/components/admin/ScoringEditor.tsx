"use client";

import { useState } from "react";
import { Button, Group, NumberInput, SegmentedControl, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { criterionQuestion } from "@shared/presets/formTemplates";
import { isLegacyScoringItem, labelsOf, OUTSTANDING_BONUS_POINTS, scoringMaxTotal, variableExists } from "@shared/scoringRules";
import { keyFromLabel } from "@shared/text";
import { scoringOf, type ScoringItem, type ScoringItemInput } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { useAction } from "@/hooks/useAction";
import { call } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { appendQuestion } from "@/lib/formsAdmin";
import { setTeamOutstanding } from "@/lib/resultsAdmin";
import { rankedRowText } from "@/components/leaderboard/rankedRowText";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, RankNumber, Row, RowList } from "@/components/ui/Rows";
import { ToggleButton } from "@/components/ui/ToggleButton";
import { Section, SubsectionTitle } from "@/components/ui/Section";
import { WithHelp } from "@/components/ui/Help";

// ----------------------------
// Le leaderboard d'un evenement : son bareme, ou les notes du jury
// ----------------------------
// SPECS §4.2 : un bareme donne des points aux criteres du jury (notes de 0 a 5,
// grilles du 17/11). Tout se regle ici : choisir un critere, ou en creer un (la
// question s'ajoute au formulaire de jury), dire combien de points il vaut, et
// s'il sert seulement a departager (dans l'ordre du bareme). Les anciens elements
// (points par unite d'une metrique, proportionnels a la meilleure equipe) restent
// lus et comptes, mais ne se creent plus (§4.6 du document). Chaque enregistrement
// passe par `setEventScoring` (verifie, journalise, recalcule le classement).
// Sans bareme : les notes du jury, ou une metrique choisie. Dessous, le
// classement calcule par le serveur, tel que le staff le verifie avant de le publier.

const JURY = "__jury__";
const NEW = "__new__";

/**
 * Ce qu'on renvoie d'un element deja stocke : tout sauf sa cle (le serveur la tire de sa variable).
 * Jamais `undefined` (le SDK l'encode en `null`) : un element stocke sans `tieBreakOnly` (ou a `null`) part a `false`.
 */
const toInput = ({ label, mode, sourceKey, pointsPerUnit, maxPoints, tieBreakOnly }: ScoringItem): ScoringItemInput => ({
  label,
  mode,
  sourceKey,
  pointsPerUnit: pointsPerUnit ?? null,
  maxPoints: maxPoints ?? null,
  tieBreakOnly: tieBreakOnly === true,
});

/** Le pourquoi des points d'un element, en clair (un ancien element : son ancienne regle). */
function scoringItemRule(item: ScoringItemInput): string {
  const rule =
    item.mode === "per_unit"
      ? `Former: ${item.pointsPerUnit ?? 1} pts each`
      : item.mode === "proportional"
        ? `Former: best team gets ${item.maxPoints ?? 0}, others in proportion`
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
  // Un bareme a anciens elements ne se recopie pas : ils ne se creent plus.
  const others = events.filter((e) => e.id !== event.id && scoringOf(e)?.items.every((i) => !isLegacyScoringItem(i)));

  if (!scoring && metrics.length === 0 && criteria.length === 0) return null;
  const total = scoring ? scoringMaxTotal(scoring, criteria) : null;
  const hint = scoring && isPublished ? `Published ${formatDateTime(event.leaderboardRevealDateISOString!)}: founders see the ranking.` : undefined;
  const help = !scoring
    ? "What ranks the teams: the jury's scores, or one number of the submission. Or give points to several variables."
    : isPublished
      ? "A change recomputes it."
      : "Founders see the ranking once you publish it. A late submission scores 0.";

  return (
    <Section title={scoring ? `Leaderboard · ${total === null ? "open total" : `out of ${total}`}` : "Leaderboard"} hint={hint} help={help}>
      {!scoring && <RankingControl />}
      <RowList>
        {items.map((item, i) => {
          const missing = !variableExists(item, metrics, criteria);
          return (
            <ButtonRow opens
              key={item.key}
              onClick={() => setEditing(i)}
              title={item.label}
              subtitle={missing ? <Text span c="orange" inherit>No question writes this variable anymore</Text> : scoringItemRule(item)}
            />
          );
        })}
        <ButtonRow opens onClick={() => setEditing("new")} title={scoring ? "Add an item" : "Score with points instead"} subtitle={scoring ? undefined : "Points per jury criterion, tie-breaks"} />
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
      <Ranking />
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

/**
 * Le classement calcule (`leaderboards/{eventId}`, recalcule a chaque saisie). Une equipe au maximum de sa
 * grille (`outstandingEligible`, calcule par le serveur) peut recevoir l'Outstanding mention (decision du 17/11).
 * Les elements mis a 0 avant le 17/11 restent indiques.
 */
function Ranking() {
  const { event, leaderboard: board, submissionsByTeamId } = useAdminEvent();
  if (!board || board.rows.length === 0) return null;
  return (
    <Stack gap="xs" mt="md">
      <SubsectionTitle>Ranking · computed {formatDateTime(board.computedDateISOString)}</SubsectionTitle>
      <RowList>
        {[...board.rows]
          .sort((a, b) => a.rank - b.rank)
          .map((row) => {
            const zeroed = labelsOf(board.scoring ?? { items: [] }, submissionsByTeamId.get(row.targetId)?.zeroedItemKeys ?? []);
            const text = rankedRowText(board, row, zeroed.length ? [`Set to 0: ${zeroed.join(", ")}`] : []);
            const value = (
              <Text className="num" fw={600}>
                {text.value}
              </Text>
            );
            return (
              <Row
                key={row.targetId}
                leading={<RankNumber rank={row.rank} />}
                title={row.name}
                subtitle={text.subtitle}
                meta={
                  row.outstandingEligible ? (
                    <Group gap="xs" wrap="nowrap">
                      {value}
                      <ToggleButton
                        on={row.outstanding === true}
                        onToggle={(next) => setTeamOutstanding(event.id, row.targetId, next, submissionsByTeamId.has(row.targetId))}
                      >
                        Outstanding +{OUTSTANDING_BONUS_POINTS}
                      </ToggleButton>
                    </Group>
                  ) : (
                    value
                  )
                }
              />
            );
          })}
      </RowList>
    </Stack>
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

/**
 * Un element du bareme : un critere du jury (existant ou nouveau), ses points, departage ou non.
 * Un ancien element (points par unite, proportionnel : retires le 17/11) se lit, se deplace ou se
 * retire, mais ne se modifie plus (`setEventScoring` le refuserait).
 */
function ItemSheet(props: ItemSheetProps) {
  const item = props.index === null ? null : props.items[props.index];
  return (
    <ResponsiveDialog opened onClose={props.onClose} title={item ? item.label : "New item"}>
      <Stack gap="md">
        {item && isLegacyScoringItem(item) ? (
          <Text size="sm" c="dimmed">
            {scoringItemRule(item)}. From before the jury grids (17/11): it still counts as it is. Move it or remove it; a new item scores a jury criterion.
          </Text>
        ) : (
          <CriterionItemForm {...props} />
        )}
        {props.index !== null && <ItemOrderActions {...props} index={props.index} />}
      </Stack>
    </ResponsiveDialog>
  );
}

/** Le critere, ses points, departage ou non : un nouveau critere s'ajoute d'abord au formulaire de jury. */
function CriterionItemForm({ index, items, isSaving, onSave }: ItemSheetProps) {
  const { metrics, criteria, juryForm } = useAdminEvent();
  const { isBusy: isAdding, run } = useAction();
  const isBusy = isSaving || isAdding;
  const item = index === null ? null : items[index];
  const [variable, setVariable] = useState<string | null>(item?.sourceKey ?? null);
  const [newLabel, setNewLabel] = useState("");
  // Les grilles du 17/11 : chaque critere note de 0 a 5.
  const [newScaleMax, setNewScaleMax] = useState<number>(5);
  const [points, setPoints] = useState<number | null>(item?.maxPoints ?? null);
  const [tieBreakOnly, setTieBreakOnly] = useState(item?.tieBreakOnly === true);

  const used = new Set(items.filter((_, i) => i !== index).map((i) => i.sourceKey));
  const options = [
    ...criteria.filter((c) => !used.has(c.key)).map((c) => ({ value: c.key, label: `${c.label} (${c.key})` })),
    ...(juryForm ? [{ value: NEW, label: "New jury criterion..." }] : []),
  ];
  const isNew = variable === NEW;
  const newKey = newLabel.trim() ? keyFromLabel(newLabel) : null;
  const newKeyTaken = newKey !== null && [...metrics, ...criteria].some((v) => v.key === newKey);
  const sourceKey = isNew ? (newKeyTaken ? null : newKey) : variable;
  const label = isNew ? newLabel.trim() : (criteria.find((c) => c.key === variable)?.label ?? item?.label ?? "");
  const scaleMax = isNew ? newScaleMax : (criteria.find((c) => c.key === variable)?.max ?? null);
  // Un critere vaut par defaut sa note telle quelle (son echelle).
  const effectivePoints = points ?? scaleMax;

  const draft: ScoringItemInput | null =
    sourceKey && label ? { label, mode: "criterion", sourceKey, pointsPerUnit: null, maxPoints: effectivePoints, tieBreakOnly } : null;

  const submit = async () => {
    if (!draft) return;
    // Un nouveau critere : sa question s'ajoute d'abord au formulaire de jury (nouvelle version s'il est publie).
    if (isNew && juryForm) {
      const question = criterionQuestion({ key: draft.sourceKey, label, min: 0, max: newScaleMax, weight: 1 });
      const added = await run(() => appendQuestion(juryForm, question), `${label} added to the jury form`);
      if (added === undefined) return;
    }
    const list = items.map(toInput);
    const next = index === null ? [...list, draft] : list.map((x, i) => (i === index ? draft : x));
    await onSave(next, index === null ? "Item added" : "Item saved");
  };

  return (
    <>
      <Select
        label="Jury criterion"
        placeholder={juryForm ? "Choose" : undefined}
        description={juryForm ? undefined : "Create the event's jury form first (Forms above)."}
        data={options}
        value={variable}
        onChange={setVariable}
        allowDeselect={false}
      />
      {isNew && (
        <Group grow align="flex-start">
          <TextInput
            label="Criterion"
            description={newKey && !newKeyTaken ? `Key: ${newKey}` : undefined}
            error={newKeyTaken ? `\`${newKey}\` already exists: choose it in the list.` : undefined}
            value={newLabel}
            onChange={(e) => setNewLabel(e.currentTarget.value)}
          />
          <NumberInput label="Scored out of" min={1} max={100} value={newScaleMax} onChange={(v) => setNewScaleMax(typeof v === "number" ? v : 5)} />
        </Group>
      )}
      <WithHelp label="Points" help="Empty: the jury's score as it is.">
        {(field) => <NumberInput {...field} min={0} value={points ?? ""} onChange={(v) => setPoints(typeof v === "number" ? v : null)} />}
      </WithHelp>
      <WithHelp label="Tie-break only" help="It does not count in the total; it separates equal totals, in the order of the list.">
        {(field) => (
          <Switch {...field} checked={tieBreakOnly} onChange={(e) => setTieBreakOnly(e.currentTarget.checked)} />
        )}
      </WithHelp>
      {draft && (
        <Text size="sm" c="dimmed">
          A jury average of {(scaleMax ?? 0) / 2} out of {scaleMax} gives {(effectivePoints ?? 0) / 2} pts.
        </Text>
      )}
      <Button size="md" fullWidth loading={isBusy} disabled={!draft} onClick={() => void submit()}>
        Save
      </Button>
    </>
  );
}

/** Deplacer ou retirer un element enregistre (ancien element compris). */
function ItemOrderActions({ index, items, isSaving, onSave }: ItemSheetProps & { index: number }) {
  const list = items.map(toInput);
  const move = (delta: -1 | 1) => {
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    void onSave(next, "Order saved");
  };
  return (
    <Group justify="space-between">
      <Group gap="xs">
        <Button variant="default" disabled={isSaving || index === 0} onClick={() => move(-1)}>
          Move up
        </Button>
        <Button variant="default" disabled={isSaving || index === items.length - 1} onClick={() => move(1)}>
          Move down
        </Button>
      </Group>
      <Button variant="subtle" color="red" disabled={isSaving} onClick={() => void onSave(list.filter((_, i) => i !== index), "Item removed")}>
        Remove
      </Button>
    </Group>
  );
}
