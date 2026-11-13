"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Anchor, Box, Button, Container, Group, MultiSelect, NumberInput, SegmentedControl, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { JUDGE_LIMITS, type PublicChoice, type PublicFormQuestion } from "@shared/callables";
import { FORM_ANSWER_MAX, ratingScale } from "@shared/formRules";
import { answerKey, isPerTarget, needsAccount, parseAnswerKey, type QuestionScope } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { usePublicForm } from "@/context/PublicFormContext";
import { call } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { draftsFromPrefill, isEmptyDraft, newSubmissionId, problemOf, toAnswers, type Draft, type Drafts } from "@/components/forms/formDrafts";

// ----------------------------
// Un formulaire a portee, sur une seule page (SPECS §2, modele standard)
// ----------------------------
// Le Debrief d'un hackathon et le jury : des questions sur l'equipe du
// repondant (« son equipe »), sur chacun de ses coequipiers, ou sur chaque
// equipe a noter. Le serveur rend les cibles ; la page les deplie. Une identite
// prouvee (compte, lien de jury) retrouve ses reponses (`prefill`) : chaque
// enregistrement renvoie TOUT le formulaire (les valeurs deja donnees comprises,
// un champ vide n'efface rien), sous un nouvel envoi, puis la page se relit.
// Un jure note une equipe apres l'autre : chaque equipe a son bouton, qui
// n'envoie que cette equipe.

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
  if (needsAccount(form.identityCheck) && !form.viewerFounderId) {
    return (
      <Frame>
        {header}
        <Text size="sm" mb="md">
          Sign in with your Pioneers account to answer: this form is tied to your name.
        </Text>
        <Button component={Link} href={paths.signIn(paths.form(form.formId))} size="md">
          Sign in
        </Button>
      </Frame>
    );
  }
  if (form.identityCheck !== "anonymous" && !form.respondent) {
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

/** Qui repond : un nom de la liste (fondateur, ou jure), ou un nom saisi par un jure exterieur. */
function WhoAreYou() {
  const { form, setRespondent } = usePublicForm();
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const typed = name.trim();
  const isJury = form.identityCheck === "jury_link";
  const options = form.respondents.map((r) => ({ value: r.value, label: r.hint ? `${r.label} · ${r.hint}` : r.label }));
  const start = () => setRespondent(typed ? { name: typed } : isJury ? { judgeId: chosen! } : { founderId: chosen! });

  return (
    <Stack gap="md" maw={480}>
      <Text size="sm" c="dimmed">
        {isJury ? "Who is scoring? Your scores are shared with the Pioneers team only." : "Who are you?"}
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
  const canEdit = form.state === "open";
  const isPreview = form.state === "draft";

  const of = (scope: QuestionScope) => form.questions.filter((q) => q.scope === scope);
  const self = of("self");
  const team = of("team");
  const mates = of("each_teammate");
  const scored = of("each_target");
  const isJury = form.identityCheck === "jury_link";

  if ((team.length > 0 || mates.length > 0) && !form.team) {
    return <Empty>You were not in a team at this event, or the teams are not published yet.</Empty>;
  }

  const set = (key: string, value: Draft | undefined) => setDrafts((d) => ({ ...d, [key]: value }));
  const byId = new Map(form.questions.map((q) => [q.id, q]));
  const questionOf = (key: string) => byId.get(parseAnswerKey(key).questionId);

  /** Le premier probleme des reponses envoyees (`onlyTarget` : une seule equipe notee). */
  const problemIn = (onlyTarget: string | null) => {
    for (const q of form.questions) {
      const scope = q.scope;
      const targets = isPerTarget(scope) ? form.targets[scope].filter((t) => !onlyTarget || t.value === onlyTarget) : [null];
      if (onlyTarget && !isPerTarget(scope)) continue;
      for (const t of targets) {
        const p = problemOf(q, drafts[answerKey(q.id, t?.value ?? null)]);
        if (p) return `${q.label}${t ? ` (${t.label})` : ""}: ${p}`;
      }
    }
    return null;
  };

  /** Enregistre la feuille ; depuis une equipe notee (`onlyTarget`), ses seules notes. */
  async function save(onlyTarget: string | null = null): Promise<boolean> {
    const problem = problemIn(onlyTarget);
    if (problem) {
      notifications.show({ color: "red", title: "Not saved yet", message: problem });
      return false;
    }
    setSending(true);
    try {
      const sent = onlyTarget ? Object.fromEntries(Object.entries(drafts).filter(([key]) => parseAnswerKey(key).targetId === onlyTarget)) : drafts;
      await call("submitFormResponse")({
        formId: form.formId,
        version: form.version,
        submissionId,
        respondent: respondentInput,
        key: juryKey,
        answers: toAnswers(sent, (key) => questionOf(key)?.type),
      });
      notifications.show({ color: "teal", message: isJury ? "Scores saved" : "Saved" });
      // Un nouvel envoi pour la prochaine correction ; la page relit les valeurs enregistrees.
      setSubmissionId(newSubmissionId());
      reload();
      return true;
    } catch (err) {
      notifications.show({ color: "red", title: "Not saved", message: errorMessage(err) });
      return false;
    } finally {
      setSending(false);
    }
  }

  const fields = (questions: PublicFormQuestion[], targetId: string | null) => (
    <Stack gap="md" py="xs">
      {questions.map((q) => (
        <SheetField key={q.id} q={q} disabled={!canEdit} value={drafts[answerKey(q.id, targetId)]} onChange={(v) => set(answerKey(q.id, targetId), v)} />
      ))}
    </Stack>
  );

  return (
    <>
      {form.respondent && form.identityCheck !== "account" && form.identityCheck !== "email_code" && (
        <Text size="sm" mb="md">
          {isJury ? "Scoring as " : "Answering as "}
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
      {form.state === "closed" && <Empty>{isJury ? "Scores are locked. You can still read yours." : "This form is closed. You can still read your answers."}</Empty>}
      {form.state === "not_open_yet" && <Empty>This form is not open yet. Come back later.</Empty>}
      {isPreview && <Empty>Draft: you are previewing it. Publish the form to collect answers.</Empty>}

      {self.length > 0 && <Section title="You">{fields(self, null)}</Section>}
      {team.length > 0 && form.team && (
        <Section title={`Your team · ${form.team.name}`} hint="One teammate can fill this in for the whole team. The last save counts.">
          {fields(team, null)}
        </Section>
      )}
      {mates.length > 0 && (
        <Section title="Your teammates" hint="Private: only the Pioneers team reads it.">
          {form.targets.each_teammate.length === 0 ? (
            <Empty>No teammate to rate.</Empty>
          ) : (
            <Stack gap="lg">
              {form.targets.each_teammate.map((t) => (
                <Box key={t.value}>
                  <Text fw={600}>{t.label}</Text>
                  {fields(mates, t.value)}
                </Box>
              ))}
            </Stack>
          )}
        </Section>
      )}
      {scored.length > 0 && (
        <TargetList
          targets={form.targets.each_target}
          isDone={(id) => scored.some((q) => !isEmptyDraft(drafts[answerKey(q.id, id)]))}
          openId={openId}
          setOpenId={setOpenId}
          render={(id) => (
            <>
              {fields(scored, id)}
              {canEdit && (
                <Button size="md" fullWidth maw={400} mb="md" loading={isSending} onClick={async () => (await save(id)) && setOpenId(null)}>
                  Save scores
                </Button>
              )}
            </>
          )}
        />
      )}

      {canEdit && (self.length > 0 || team.length > 0 || mates.length > 0) && (
        <div className="savebar" style={{ bottom: 0 }}>
          <Button size="md" fullWidth maw={400} loading={isSending} onClick={() => void save()}>
            {form.prefill && Object.keys(form.prefill).length > 0 ? "Save changes" : "Submit"}
          </Button>
        </div>
      )}
      <Group mt="xl">
        <Button component={Link} href={paths.home()} variant="subtle" color="gray">
          Go to Pioneers Hub
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
}: {
  q: PublicFormQuestion;
  value: Draft | undefined;
  onChange: (value: Draft | undefined) => void;
  disabled: boolean;
}) {
  const { form } = usePublicForm();
  const label = (
    <>
      {q.label}
      {q.required && <Text span c="pioneers"> *</Text>}
    </>
  );
  const common = { label, description: q.description ?? undefined, disabled };
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
      if (steps > 11) {
        return <NumberInput {...common} min={scale.min} max={scale.max} value={typeof value === "number" ? value : ""} onChange={(v) => onChange(typeof v === "number" ? v : undefined)} />;
      }
      return (
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            {label}
            <Text span c="dimmed" size="sm">{` · ${scale.min} to ${scale.max}`}</Text>
          </Text>
          {q.description && (
            <Text size="xs" c="dimmed">
              {q.description}
            </Text>
          )}
          <SegmentedControl
            fullWidth
            disabled={disabled}
            aria-label={q.label}
            data={Array.from({ length: steps }, (_, i) => String(scale.min + i))}
            value={typeof value === "number" ? String(value) : ""}
            onChange={(v) => onChange(Number(v))}
          />
        </Stack>
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
          description={q.description ?? (max > 1 ? `Up to ${max}, your first choice first.` : undefined)}
          value={Array.isArray(value) ? value : []}
          onChange={(v) => onChange(v)}
        />
      );
    }
  }
}
