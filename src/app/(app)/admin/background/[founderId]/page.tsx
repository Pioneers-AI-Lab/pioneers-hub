"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Group, SegmentedControl, Stack, Switch, Text } from "@mantine/core";
import {
  BACKGROUND_CRITERIA,
  BACKGROUND_MAX_NOTE,
  BACKGROUND_OUTSTANDING_BONUS,
  backgroundProblems,
  backgroundScore,
  canBeOutstanding,
  isBackgroundRated,
  type BackgroundScores,
} from "@shared/background";
import { EXISTING_CO_FOUNDERS_LABELS, type FounderBackground } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useAdminBackground, type BackgroundRow } from "@/context/AdminBackgroundContext";
import { useAction } from "@/hooks/useAction";
import { useParamsTS } from "@/hooks/useParamsTS";
import { saveBackground } from "@/lib/backgroundAdmin";
import { formatDateTime, yesNoLabel } from "@/lib/format";
import { paths } from "@/lib/paths";
import { ActionBar } from "@/components/admin/ActionBar";
import { BlockedState } from "@/components/ui/BlockedState";
import { ExternalLink, Field, FieldGrid } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { Section } from "@/components/ui/Section";
import { tagsOrNull } from "@/components/ui/Tags";
import { WithHelp } from "@/components/ui/Help";

// ----------------------------
// Admin > Background > un fondateur : les faits du profil, puis la grille
// ----------------------------
// Les quatre criteres de 0 a 5 (shared/background.ts) ; l'Outstanding ne s'active qu'a
// 100. La grille part de la note enregistree, sinon de la proposition de Claude (dite
// comme telle), sinon vide. Enregistrer passe au fondateur suivant a noter.

const NOTES = Array.from({ length: BACKGROUND_MAX_NOTE + 1 }, (_, i) => String(i));

type Draft = NonNullable<FounderBackground["scores"]>;

export default function AdminBackgroundFounderPage() {
  const { founderId } = useParamsTS<{ founderId: string }>();
  const { rows, rowOf, isLoading } = useAdminBackground();
  if (isLoading) return <PageLoader />;
  const row = rowOf(founderId);
  if (!row) return <BlockedState reason="not_found" backHref={paths.adminBackground()} />;
  // Le suivant a noter, dans l'ordre de la liste.
  const next = rows.find((r) => r.founder.id !== founderId && !isBackgroundRated(r.background)) ?? null;
  // Une cle par fondateur : passer au suivant repart de SA note.
  return <BackgroundGrid key={founderId} row={row} nextFounderId={next?.founder.id ?? null} />;
}

function BackgroundGrid({ row, nextFounderId }: { row: BackgroundRow; nextFounderId: string | null }) {
  const router = useRouter();
  const { user } = useAuth();
  const { busy, run } = useAction();
  const { founder, directory: d, background } = row;
  const rated = isBackgroundRated(background);
  const proposed = background?.proposed ?? null;
  const start = rated ? background! : proposed;
  const [draft, setDraft] = useState<Draft>(() => ({ ...start?.scores }));
  const [outstanding, setOutstanding] = useState(start?.outstanding === true);

  const allowed = canBeOutstanding(draft);
  const isOutstanding = outstanding && allowed;
  const problem = backgroundProblems(draft, isOutstanding)[0] ?? null;
  const total = backgroundScore(draft, isOutstanding);

  const save = async () => {
    if (!user || problem) return;
    const ok = await run(async () => (await saveBackground(founder.id, draft as BackgroundScores, isOutstanding, user.id), true), `${founder.name}: Background saved.`);
    if (ok) router.push(nextFounderId ? paths.adminBackgroundFounder(nextFounderId) : paths.adminBackground());
  };

  const status = rated
    ? `Rated ${formatDateTime(background?.ratedDateISOString ?? null)}`
    : proposed
      ? "Not rated yet: the scores below are Claude's proposal, check them before saving."
      : "Not rated yet.";

  return (
    <>
      <PageHeader back={{ href: paths.adminBackground(), label: "Background" }} title={founder.name} subtitle={status} />

      <Section title="Profile">
        {!d ? (
          <Text size="sm" c="dimmed">
            No profile book entry.
          </Text>
        ) : (
          <Stack gap="md">
            <Field label="Track record">{d.trackRecord}</Field>
            <FieldGrid>
              <Field label="Years of experience" showEmpty>
                {d.yearsOfXP ?? null}
              </Field>
              <Field label="Repeat founder" showEmpty>
                {yesNoLabel(d.repeatFounder)}
              </Field>
              <Field label="Nationality">{d.nationality}</Field>
              <Field label="Country">{d.country}</Field>
              <Field label="Degree">{[d.degree, d.fieldOfStudy].filter(Boolean).join(", ") || null}</Field>
              <Field label="Main startup in 2025">{d.mainStartup2025}</Field>
              <Field label="Existing project">{yesNoLabel(d.hasExistingProject)}</Field>
              <Field label="Existing co-founders">{d.hasExistingCoFounders ? EXISTING_CO_FOUNDERS_LABELS[d.hasExistingCoFounders] : null}</Field>
            </FieldGrid>
            <Field label="Education">{tagsOrNull(d.education)}</Field>
            <Field label="Notable companies">{tagsOrNull(d.notableCompanies)}</Field>
            <Field label="Project">{d.projectExplanation}</Field>
            <Field label="LinkedIn">
              <ExternalLink href={d.linkedinUrl} />
            </Field>
          </Stack>
        )}
      </Section>

      <Section title="Grid" help={`Each criterion from 0 to ${BACKGROUND_MAX_NOTE}: it earns score ÷ ${BACKGROUND_MAX_NOTE} × its points.`}>
        {BACKGROUND_CRITERIA.map((c) => (
          <Stack key={c.key} gap="xs">
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text fw={500}>{c.label}</Text>
              <Text size="sm" c="dimmed" className="num">
                {c.points} points
              </Text>
            </Group>
            {c.definition && (
              <Text size="sm" c="dimmed">
                {c.definition}
              </Text>
            )}
            <SegmentedControl
              fullWidth
              data={NOTES}
              value={draft[c.key] == null ? "" : String(draft[c.key])}
              onChange={(v) => setDraft((prev) => ({ ...prev, [c.key]: Number(v) }))}
            />
          </Stack>
        ))}
        <WithHelp label={`Outstanding mention (+${BACKGROUND_OUTSTANDING_BONUS})`} help="Only for an exceptional profile." note={allowed ? undefined : "Only at 100: every criterion at 5."}>
          {(field) => (
            <Switch
              size="md"
              {...field}
              checked={isOutstanding}
              disabled={!allowed}
              onChange={(e) => setOutstanding(e.currentTarget.checked)}
            />
          )}
        </WithHelp>
        {proposed?.reasoning && (
          <Field label="Claude's reasoning">{proposed.reasoning}</Field>
        )}
        <Text fw={500} className="num">
          {total === null ? "Not scored yet" : `Background: ${total}${isOutstanding ? " (100 + Outstanding)" : " / 100"}`}
        </Text>
      </Section>

      <ActionBar label={nextFounderId ? "Save and rate the next founder" : "Save"} problem={problem} loading={busy !== null} disabled={problem !== null || busy !== null} onClick={() => void save()} />
    </>
  );
}
