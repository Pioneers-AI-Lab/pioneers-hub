"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Anchor, Box, Button, Container, Group, Input, MultiSelect, NumberInput, SegmentedControl, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { APP_NAME } from "@shared/brand";
import { JUDGE_LIMITS, type PublicChoice, type PublicFormQuestion } from "@shared/callables";
import { FORM_ANSWER_MAX, ratingScale } from "@shared/formRules";
import { answerKey, parseAnswerKey } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { usePublicForm } from "@/context/PublicFormContext";
import { call } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section, SubsectionTitle } from "@/components/ui/Section";
import { JuryBrief, MetricRankNote } from "@/components/forms/JuryBrief";
import {
  PENDING_NOTE,
  draftsFromPrefill,
  formNotes,
  isEmptyDraft,
  newSubmissionId,
  notifySendError,
  problemOf,
  toAnswers,
  type Draft,
  type Drafts,
} from "@/components/forms/formDrafts";

// ----------------------------
// Le jury, sur une seule page (SPECS §4.2)
// ----------------------------
// Les formulaires des fondateurs (equipe et coequipiers compris) vont un ecran a la
// fois (`TypeForm`, 18/11) ; le jury compare les equipes, il garde la page : une
// question par critere sur chaque equipe a noter (les seules questions d'un jury,
// `formProblems`). Le jure choisit ou saisit son nom, retrouve ses notes
// (`prefill`) et note une equipe apres l'autre : chaque equipe a son bouton, qui
// n'envoie que cette equipe ; au-dessus de ses criteres, sa Submission et les
// chiffres declares de toutes les equipes (`JuryBrief`).
// Apercu du staff (`preview`) : les questions, sans repondant ni envoi.

function Frame({ children }: { children: ReactNode }) {
  return (
    <Container size={640} px="md" py="xl">
      {children}
    </Container>
  );
}

export function FormSheet() {
  const { form, respondentInput } = usePublicForm();
  const header = <SheetHeader />;
  if (!form.respondent && !form.preview) {
    return (
      <Frame>
        {header}
        {respondentInput && <Empty>This name is not in the list any more: choose it again.</Empty>}
        <WhoAreYou />
      </Frame>
    );
  }
  // `key` : une relecture apres envoi repart des valeurs du serveur.
  return (
    <Frame>
      {header}
      <Sheet key={JSON.stringify(form.prefill)} />
    </Frame>
  );
}

function SheetHeader() {
  const { form } = usePublicForm();
  const { firebaseUser } = useAuth();
  const subtitle = [form.event?.name ?? form.batchName, form.deadlineDateISOString && `Due ${formatDateTime(form.deadlineDateISOString)}`]
    .filter(Boolean)
    .join(" · ");
  // Connecte : retour a la page de l'evenement (ce qui lui est attache).
  const back = firebaseUser && form.event ? { href: paths.event(form.event.programId, form.event.batchId, form.event.id), label: form.event.name } : undefined;
  return (
    <>
      <PageHeader back={back} title={form.title} subtitle={subtitle || undefined} />
      {form.description && (
        <Text size="sm" c="dimmed" mb="md">
          {form.description}
        </Text>
      )}
    </>
  );
}

/** Qui note : un nom de la liste (fondateur, staff, invite), ou un nom saisi par un jure exterieur. */
function WhoAreYou() {
  const { form, setRespondent } = usePublicForm();
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const typed = name.trim();
  const options = form.respondents.map((r) => ({ value: r.value, label: r.hint ? `${r.label} · ${r.hint}` : r.label }));
  const start = () => setRespondent(typed ? { name: typed } : { judgeId: chosen! });

  return (
    <Stack gap="md" maw={480}>
      <Text size="sm" c="dimmed">
        Who is scoring? Your scores are shared with the Pioneers team only.
      </Text>
      {options.length > 0 && (
        <Select
          label="Pick your name"
          placeholder="Search"
          searchable
          data={options}
          value={chosen}
          onChange={(v) => {
            setChosen(v);
            if (v) setName("");
          }}
          nothingFoundMessage={form.allowTypedName ? "Not in the list: type your name below" : "No match"}
        />
      )}
      {form.allowTypedName && (
        <TextInput
          label={options.length > 0 ? "Not in the list? Type your name" : "Your name"}
          // Formulaire public : la consigne reste visible (docs/UI-RULES.md §10).
          description="First and last name, so the team knows who scored."
          maxLength={JUDGE_LIMITS.name}
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
            if (e.currentTarget.value.trim()) setChosen(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typed) start();
          }}
        />
      )}
      <Button size="md" fullWidth disabled={!typed && !chosen} onClick={start}>
        Continue
      </Button>
    </Stack>
  );
}

function Sheet() {
  const { form, juryKey, respondentInput, setRespondent, reload } = usePublicForm();
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFromPrefill(form.prefill));
  const [submissionId, setSubmissionId] = useState(newSubmissionId);
  const [isSending, setSending] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const isPreview = form.preview;
  // L'apercu se remplit pour voir les champs, sans rien envoyer.
  const canFill = form.state === "open" || isPreview;
  const canEdit = canFill && !isPreview;
  const targets = form.targets.each_target;

  const set = (key: string, value: Draft | undefined) => setDrafts((d) => ({ ...d, [key]: value }));
  const byId = new Map(form.questions.map((q) => [q.id, q]));
  const questionOf = (key: string) => byId.get(parseAnswerKey(key).questionId);

  /** Le premier probleme des notes d'une equipe. */
  const problemIn = (targetId: string) => {
    const target = targets.find((t) => t.value === targetId);
    for (const q of form.questions) {
      const p = problemOf(q, drafts[answerKey(q.id, targetId)]);
      if (p) return `${q.label}${target ? ` (${target.label})` : ""}: ${p}`;
    }
    return null;
  };

  /** Enregistre les notes d'une equipe, et seulement les siennes. */
  async function save(targetId: string): Promise<boolean> {
    const problem = problemIn(targetId);
    if (problem) {
      notifications.show({ color: "red", title: "Not saved yet", message: problem });
      return false;
    }
    setSending(true);
    try {
      const sent = Object.fromEntries(Object.entries(drafts).filter(([key]) => parseAnswerKey(key).targetId === targetId));
      await call("submitFormResponse")({
        formId: form.formId,
        version: form.version,
        submissionId,
        respondent: respondentInput,
        key: juryKey,
        answers: toAnswers(sent, (key) => questionOf(key)?.type),
      });
      notifications.show({ color: "teal", message: "Scores saved" });
      // Un nouvel envoi pour la prochaine correction ; la page relit les valeurs enregistrees.
      setSubmissionId(newSubmissionId());
      reload();
      return true;
    } catch (err) {
      notifySendError(err, "Not saved", reload);
      return false;
    } finally {
      setSending(false);
    }
  }

  const fields = (targetId: string) => (
    <Stack gap="md" py="xs">
      {form.questions.map((q) => {
        const key = answerKey(q.id, targetId);
        return (
          <Stack key={q.id} gap="xs">
            <SheetField q={q} disabled={!canFill} pending={form.pendingAnswerKeys.includes(key)} value={drafts[key]} onChange={(v) => set(key, v)} />
            {/* Un critere chiffre : la valeur de la cible, sa place, la meilleure (« 5 = la meilleure equipe »). */}
            {form.juryBrief && <MetricRankNote brief={form.juryBrief} targets={targets} targetId={targetId} questionId={q.id} />}
          </Stack>
        );
      })}
    </Stack>
  );

  return (
    <>
      {form.respondent && (
        <Text size="sm" mb="md">
          {"Scoring as "}
          <strong>{form.respondent.label}</strong>
          {!form.viewerFounderId && (
            <>
              {" · "}
              <Anchor component="button" type="button" size="sm" className="tap-link" onClick={() => setRespondent(null)}>
                Not you?
              </Anchor>
            </>
          )}
        </Text>
      )}
      {form.state === "closed" && <Empty>Scores are locked. You can still read yours.</Empty>}
      {form.state === "not_open_yet" && <Empty>This form is not open yet. Come back later.</Empty>}
      {formNotes(form).map((note) => (
        <Empty key={note}>{note}</Empty>
      ))}

      {targets.length > 0 && (
        <TargetList
          targets={targets}
          isDone={(id) => form.questions.some((q) => !isEmptyDraft(drafts[answerKey(q.id, id)]))}
          openId={openId}
          setOpenId={setOpenId}
          render={(id) => (
            <>
              {form.juryBrief && (
                <>
                  <JuryBrief brief={form.juryBrief} targets={targets} targetId={id} />
                  <SubsectionTitle>Your scores</SubsectionTitle>
                </>
              )}
              {fields(id)}
              {canEdit && (
                <Button size="md" fullWidth maw={400} mb="md" loading={isSending} onClick={async () => (await save(id)) && setOpenId(null)}>
                  Save scores
                </Button>
              )}
            </>
          )}
        />
      )}

      <Group mt="xl">
        <Button component={Link} href={paths.home()} variant="subtle" color="gray">
          Go to {APP_NAME}
        </Button>
      </Group>
    </>
  );
}

/** Les equipes (ou startups) a noter : une ligne chacune, qui deplie ses questions. */
function TargetList({
  targets,
  isDone,
  openId,
  setOpenId,
  render,
}: {
  targets: PublicChoice[];
  isDone: (id: string) => boolean;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  render: (id: string) => ReactNode;
}) {
  const done = targets.filter((t) => isDone(t.value)).length;
  return (
    <Section title={`To score · ${done} of ${targets.length}`}>
      {targets.length === 0 ? (
        <Empty>Nothing to score yet. Teams show up here once they are published.</Empty>
      ) : (
        <RowList>
          {targets.map((t) => (
            <Box key={t.value}>
              <ButtonRow
                onClick={() => setOpenId(openId === t.value ? null : t.value)}
                expanded={openId === t.value}
                title={t.label}
                subtitle={t.hint ?? undefined}
                meta={isDone(t.value) ? "Scored" : <Text size="sm" c="pioneers">To score</Text>}
              />
              {openId === t.value && render(t.value)}
            </Box>
          ))}
        </RowList>
      )}
    </Section>
  );
}

/** Une question, en champ compact (la page porte plusieurs questions a la fois). */
function SheetField({
  q,
  value,
  onChange,
  disabled,
  pending,
}: {
  q: PublicFormQuestion;
  value: Draft | undefined;
  onChange: (value: Draft | undefined) => void;
  disabled: boolean;
  /** La valeur est la reponse envoyee, en attente de validation du staff. */
  pending: boolean;
}) {
  const { form } = usePublicForm();
  const label = (
    <>
      {q.label}
      {q.required && <Text span c="var(--input-asterisk-color)"> *</Text>}
    </>
  );
  const description = [q.description, pending ? PENDING_NOTE : null].filter(Boolean).join(" ") || undefined;
  const common = { label, description, disabled };
  const text = typeof value === "string" ? value : "";

  switch (q.type) {
    case "number":
      return (
        <NumberInput
          {...common}
          min={0}
          value={typeof value === "number" ? value : ""}
          onChange={(v) => onChange(typeof v === "number" ? v : undefined)}
        />
      );
    case "rating": {
      const scale = ratingScale(q);
      const steps = scale.max - scale.min + 1;
      const ratingLabel = (
        <>
          {label}
          <Text span c="dimmed" inherit>{` · ${scale.min} to ${scale.max}`}</Text>
        </>
      );
      if (steps > 11) {
        return <NumberInput {...common} label={ratingLabel} min={scale.min} max={scale.max} value={typeof value === "number" ? value : ""} onChange={(v) => onChange(typeof v === "number" ? v : undefined)} />;
      }
      // Le meme habillage (taille du theme) que les autres champs : libelle et aide a la meme taille.
      return (
        <Input.Wrapper labelElement="div" label={ratingLabel} description={description}>
          <SegmentedControl
            mt="calc(var(--mantine-spacing-xs) / 2)"
            fullWidth
            disabled={disabled}
            aria-label={q.label}
            data={Array.from({ length: steps }, (_, i) => String(scale.min + i))}
            value={typeof value === "number" ? String(value) : ""}
            onChange={(v) => onChange(Number(v))}
          />
        </Input.Wrapper>
      );
    }
    case "long_text":
      return <Textarea {...common} autosize minRows={2} maxLength={FORM_ANSWER_MAX.long_text} value={text} onChange={(e) => onChange(e.currentTarget.value)} />;
    case "text":
      return <TextInput {...common} maxLength={FORM_ANSWER_MAX.text} value={text} onChange={(e) => onChange(e.currentTarget.value)} />;
    case "link":
    case "file":
      return <TextInput {...common} inputMode="url" placeholder="https://" maxLength={FORM_ANSWER_MAX.link} value={text} onChange={(e) => onChange(e.currentTarget.value)} />;
    case "single_choice":
      return (
        <Select {...common} data={(q.options ?? []).map((o) => ({ value: o.value, label: o.label }))} value={text || null} onChange={(v) => onChange(v ?? undefined)} clearable />
      );
    case "multiple_choice":
      return (
        <MultiSelect
          {...common}
          data={(q.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
          value={Array.isArray(value) ? value : []}
          onChange={(v) => onChange(v)}
        />
      );
    case "entity_picker": {
      const data = (q.picker ? (form.choices[q.picker.entity] ?? []) : []).map((c) => ({ value: c.value, label: c.hint ? `${c.label} · ${c.hint}` : c.label }));
      const max = q.picker?.maxItems ?? 1;
      return (
        <MultiSelect
          {...common}
          searchable
          data={data}
          maxValues={max}
          description={description ?? (max > 1 ? `Up to ${max}, your first choice first.` : undefined)}
          value={Array.isArray(value) ? value : []}
          onChange={(v) => onChange(v)}
        />
      );
    }
  }
}
