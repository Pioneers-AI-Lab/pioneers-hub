"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { FAMILY_KEY, FAMILY_QUESTION_TYPE, familyOf, getFieldDef, isFormOnly, parseDbField, type DbFieldKey, type DocKind, type FieldFamily } from "@shared/fieldRegistry";
import {
  FORM_FIELD_TYPE_LABELS,
  alignQuestionWithField,
  compatibleDbFields,
  deriveAttachments,
  feedsIndicator,
  formProblems,
  isJuryCriterion,
  questionProblems,
  versionedSnapshot,
} from "@shared/formRules";
import { formState } from "@shared/forms";
import { EVENT_TEMPLATES } from "@shared/presets/eventTemplates";
import { EVENT_METRIC_RENAMES, STANDARD_METRICS, standardEventMetricKey } from "@shared/presets/standardMetrics";
import { keyFromLabel } from "@shared/text";
import { IDENTITY_RULES, activeQuestions, needsAccount, scopeOf, type Form, type FormApproval, type FormFieldType, type FormIdentityCheck, type FormKind, type FormQuestion, type PickerEntity, type QuestionScope, type WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminForm } from "@/context/AdminFormContext";
import { formatDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { archiveForm, draftOf, duplicateForm, saveForm, type FormDraft } from "@/lib/formsAdmin";
import { paths } from "@/lib/paths";
import {
  APPROVAL_OPTIONS,
  FORM_KIND_LABELS,
  IDENTITY_HINTS,
  IDENTITY_OPTIONS,
  SCOPE_LABELS,
} from "@/components/admin/formLabels";
import { ArchiveDialog } from "@/components/admin/ArchiveDialog";
import { FormResponses } from "@/components/admin/FormResponses";
import { PageHeader } from "@/components/ui/PageHeader";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Editeur de formulaire (SPECS §4.4)
// ----------------------------
// Le brouillon vit ici jusqu'a l'enregistrement. Garde-fous de l'historique,
// des qu'un formulaire a ete publie :
//   - une question supprimee est ARCHIVEE (les reponses passees la gardent) ;
//   - changer le type d'une question cree une nouvelle question (nouvel id) ;
//   - une question qui alimente un indicateur ne se supprime ni ne change de champ.
// Le modele standard (SPECS §2) : une question a une PORTEE (le repondant, son
// equipe, chaque coequipier, chaque equipe notee), dictee par son champ. Une
// metrique d'equipe (`submission.metrics.<cle>`) et un critere du jury
// (`evaluation.scores.<cle>`, avec son poids) gardent leur cle d'un evenement a
// l'autre : l'editeur propose celles des modeles et celles deja utilisees.
//
// Deux membres du staff sur le meme formulaire (piste 7.12) : une mise a jour
// distante n'efface jamais un brouillon modifie. Le brouillon garde la version
// d'ou il part (`base`) ; tant que rien de local n'attend, il suit la base en
// silence ; sinon un bandeau previent et laisse choisir, et l'enregistrement
// FUSIONNE (`mergeDraft`) : ce que l'autre a change et pas moi est garde.

const DOC_KIND_LABELS: Record<DocKind, string> = {
  person: "Person",
  founder: "Founder",
  founderDirectory: "Founder · directory",
  founderProfile: "Founder · private",
  founderInternal: "Founder · internal",
  founderWeek: "Founder · week",
  startup: "Startup",
  startupProfile: "Startup · profile",
  startupInternal: "Startup · internal",
  checkin: "Thursday update",
  attendance: "Attendance",
  sessionRating: "Session rating",
  submission: "Team submission",
  picks: "Picks",
  peerRating: "Peer rating",
  evaluation: "Jury score",
};

/** Comment l'editeur nomme une famille (le type de question qui l'alimente : `FAMILY_QUESTION_TYPE`). */
const FAMILY_CHOICES: Record<FieldFamily, { group: string; noun: string }> = {
  "submission.metrics": { group: "Team metric (submission)", noun: "metric" },
  "evaluation.scores": { group: "Jury criterion", noun: "criterion" },
};

/** Valeur de la liste pour « nouvelle cle » d'une famille. */
const NEW_KEY = (family: FieldFamily) => `${family}.__new__`;

const PICKER_ENTITIES: { value: PickerEntity; label: string }[] = [
  { value: "founder", label: "Founder" },
  { value: "startup", label: "Startup" },
  { value: "event", label: "Event" },
  { value: "team", label: "Team" },
  { value: "mentor", label: "Mentor" },
];

const newQuestionId = () => `q_${Math.random().toString(36).slice(2, 10)}`;

const blankQuestion = (): FormQuestion => ({
  id: newQuestionId(),
  type: "text",
  label: "",
  description: null,
  required: false,
  options: null,
  scale: null,
  picker: null,
  dbField: null,
  requiresApproval: null,
  archived: false,
  scope: "self",
  weight: null,
});

export function FormEditor() {
  const { form } = useAdminForm();
  // Un brouillon par formulaire : il ne se remonte pas a chaque enregistrement (le sien ou celui d'un autre).
  return <Editor key={form.id} form={form} />;
}

// ---- Fusion d'un brouillon avec la base --------------------------------------------

type DraftKey = Exclude<keyof FormDraft, "attachments">;

/** Les reglages du brouillon, tels que l'editeur les nomme (bandeau de conflit). */
const DRAFT_LABELS: Record<DraftKey, string> = {
  kind: "Type",
  title: "Title",
  description: "Description",
  questions: "Questions",
  approval: "Database writes",
  identityCheck: "Respondent",
  eventId: "Event",
  status: "Status",
  opensDateISOString: "Opens",
  deadlineDateISOString: "Deadline",
};

/** Meme valeur, quel que soit l'ordre des cles (Firestore relit un objet cles triees). */
const sameValue = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const stableJson = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v,
  );

/**
 * Fusion a trois des questions, une par une (id) : chaque question prend le
 * cote qui l'a changee, ajoutee ou retiree. L'ordre est celui du cote qui a
 * deplace des questions (le mien sinon), les ajouts de l'autre cote a la fin.
 * `conflict` : une meme question changee des deux cotes (la mienne l'emporte),
 * ou deplacees des deux cotes.
 */
function mergeQuestions(base: FormQuestion[], mine: FormQuestion[], theirs: FormQuestion[]): { questions: FormQuestion[]; conflict: boolean } {
  if (sameValue(mine, base)) return { questions: theirs, conflict: false };
  if (sameValue(theirs, base)) return { questions: mine, conflict: false };
  const byId = (list: FormQuestion[]) => new Map(list.map((q) => [q.id, q]));
  const [was, m, t] = [byId(base), byId(mine), byId(theirs)];
  const reordered = (list: FormQuestion[]) => {
    const ids = new Set(list.map((q) => q.id));
    return !sameValue([...ids].filter((id) => was.has(id)), base.map((q) => q.id).filter((id) => ids.has(id)));
  };
  const [mineMoved, theirsMoved] = [reordered(mine), reordered(theirs)];
  let conflict = mineMoved && theirsMoved;
  const [first, second] = theirsMoved && !mineMoved ? [theirs, mine] : [mine, theirs];
  const ids = [...new Set([...first, ...second].map((q) => q.id))];
  const questions = ids.flatMap((id) => {
    const before = was.get(id);
    const [mq, tq] = [m.get(id), t.get(id)];
    if (!before) return mq ?? tq ?? [];
    if (sameValue(mq, before)) return tq ?? [];
    if (!sameValue(tq, before) && !sameValue(tq, mq)) conflict = true;
    return mq ?? [];
  });
  return { questions, conflict };
}

/**
 * Fusion a trois du brouillon : `base` (la version d'ou il part), `mine` (le
 * brouillon), `theirs` (la base maintenant). Un reglage que je n'ai pas touche
 * prend leur valeur ; un reglage que j'ai change garde la mienne. `conflicts` :
 * les reglages changes des deux cotes, differemment (le mien l'emporte).
 */
function mergeDraft(base: FormDraft, mine: FormDraft, theirs: FormDraft): { draft: FormDraft; conflicts: string[] } {
  const draft: Record<string, unknown> = { ...theirs };
  const conflicts: string[] = [];
  for (const key of Object.keys(DRAFT_LABELS) as DraftKey[]) {
    if (key === "questions" || sameValue(mine[key], base[key])) continue;
    if (!sameValue(theirs[key], base[key]) && !sameValue(theirs[key], mine[key])) conflicts.push(DRAFT_LABELS[key]);
    draft[key] = mine[key];
  }
  const merged = mergeQuestions(base.questions, mine.questions, theirs.questions);
  if (merged.conflict) conflicts.push(DRAFT_LABELS.questions);
  return { draft: { ...(draft as FormDraft), questions: merged.questions }, conflicts };
}

function Editor({ form }: { form: WithId<Form> }) {
  const router = useRouter();
  const { events } = useAdmin();
  const { event, responses } = useAdminForm();
  // `base` : la version de la base d'ou part le brouillon (elle reste en arriere tant qu'une saisie attend).
  const [base, setBase] = useState<FormDraft>(() => draftOf(form));
  const [draft, setDraft] = useState<FormDraft>(base);
  const [editing, setEditing] = useState<{ original: FormQuestion | null; index: number } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  /** La confirmation d'enregistrement ouverte : `publish` (premiere publication) ou non. */
  const [confirmSave, setConfirmSave] = useState<{ publish: boolean } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Ce que l'enregistrement ecrira : mon brouillon, fusionne avec la base si elle a change entre-temps.
  const remote = draftOf(form);
  const isBehind = !sameValue(remote, base);
  const { draft: toSave, conflicts } = isBehind ? mergeDraft(base, draft, remote) : { draft, conflicts: [] };
  const isDirty = !sameValue(toSave, remote);
  // Rien de local n'attend (brouillon intact, ou echo de mon propre enregistrement) : le brouillon suit la base.
  // Une fenetre de question ouverte attend d'etre fermee : elle part de l'ancienne version.
  const loadTheirs = () => {
    setBase(remote);
    setDraft(remote);
  };
  if (isBehind && !isDirty && !editing) loadTheirs();
  const keepMine = () => {
    setBase(remote);
    setDraft(toSave);
  };

  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const isPublished = form.version > 0;
  const savedById = useMemo(() => new Map(form.questions.map((q) => [q.id, q])), [form.questions]);
  /** Publiee = presente dans une version figee : elle a pu recevoir des reponses. */
  const isPublishedQuestion = (q: FormQuestion) => isPublished && savedById.has(q.id);
  const isIndicatorLocked = (q: FormQuestion) => {
    const saved = savedById.get(q.id);
    return isPublished && saved !== undefined && feedsIndicator(saved);
  };

  const attachments = deriveAttachments(toSave.questions, form.attachments);
  const next = { ...form, ...toSave, attachments };
  const problems = formProblems(next);
  const willBumpVersion = isPublished && versionedSnapshot(next) !== versionedSnapshot(form);
  const saveLabel = willBumpVersion ? `Publish changes as version ${form.version + 1}` : "Save";
  const active = draft.questions.map((q, index) => ({ q, index })).filter(({ q }) => !q.archived);
  const archivedCount = draft.questions.length - active.length;

  /**
   * Ce que l'enregistrement change pour les repondants (C7, C10) : ceux qui
   * remplissent le formulaire, ceux qui y ont deja repondu, et des dates qui
   * manquent (pas de retard possible, hors « Forms on time »).
   */
  const saveWarnings = (publish: boolean): string[] => {
    const warnings: string[] = [];
    if (willBumpVersion) {
      const savedIds = new Set(activeQuestions(form).map((q) => q.id));
      const newRequired = activeQuestions(toSave).filter((q) => q.required && !savedIds.has(q.id)).length;
      const ask = newRequired === 1 ? "the new required question" : `the ${newRequired} new required questions`;
      if (formState(form, new Date().toISOString()) === "open") {
        warnings.push(
          newRequired > 0
            ? `Founders filling it in right now keep what they typed, and must answer ${ask} before sending.`
            : "Founders filling it in right now keep what they typed and send it to the new version.",
        );
      }
      // Des fondateurs (le To do est le leur) : ni les reponses anonymes ni celles des jures.
      const answered = new Set(responses.flatMap((r) => r.respondentFounderId ?? [])).size;
      if (answered > 0) {
        const who = `${answered} ${answered === 1 ? "founder" : "founders"} already answered.`;
        warnings.push(
          newRequired > 0
            ? `${who} The form goes back to their To do for ${ask}.`
            : `${who} Their answers stay as they are: nothing asks them again.`,
        );
      }
    }
    // Les dates se verifient a la publication, ou quand l'enregistrement les change.
    const datesChange = publish || toSave.opensDateISOString !== form.opensDateISOString || toSave.deadlineDateISOString !== form.deadlineDateISOString;
    if (datesChange && IDENTITY_RULES[toSave.identityCheck].respondent === "founder") {
      if (!toSave.deadlineDateISOString) warnings.push("No deadline: no answer can be late, and this form does not count in “Forms on time”.");
      if (publish && !toSave.opensDateISOString) warnings.push("No opening date: the form opens as soon as you publish.");
    }
    return warnings;
  };

  /** Enregistre, apres confirmation si l'enregistrement a un effet sur les repondants. */
  const requestSave = (publish: boolean) => {
    if (saveWarnings(publish).length > 0) setConfirmSave({ publish });
    else void save(publish);
  };

  const save = async (publish: boolean) => {
    setConfirmSave(null);
    setIsSaving(true);
    try {
      // Contre la base ACTUELLE : la version suivante est juste, et ce qu'un autre a change reste (fusion).
      const version = await saveForm(form, toSave, { publish });
      notifications.show({
        message: publish ? "Form published and open" : version !== form.version ? `Saved as version ${version}` : "Form saved",
      });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const applyQuestion = (original: FormQuestion | null, edited: FormQuestion) => {
    const aligned = alignQuestionWithField(edited);
    setDraft((d) => {
      if (!original) return { ...d, questions: [...d.questions, aligned] };
      // Type change d'une question publiee : l'ancienne est archivee, la nouvelle a un nouvel id.
      if (isPublishedQuestion(original) && original.type !== aligned.type) {
        return {
          ...d,
          questions: [
            ...d.questions.map((q) => (q.id === original.id ? { ...q, archived: true } : q)),
            { ...aligned, id: newQuestionId() },
          ],
        };
      }
      return { ...d, questions: d.questions.map((q) => (q.id === original.id ? aligned : q)) };
    });
    setEditing(null);
  };

  const removeQuestion = (original: FormQuestion) => {
    setDraft((d) => ({
      ...d,
      questions: isPublishedQuestion(original)
        ? d.questions.map((q) => (q.id === original.id ? { ...q, archived: true } : q))
        : d.questions.filter((q) => q.id !== original.id),
    }));
    setEditing(null);
  };

  /** Deplace parmi les questions actives (les archivees gardent leur place). */
  const moveQuestion = (id: string, delta: -1 | 1) => {
    setDraft((d) => {
      const list = [...d.questions];
      const from = list.findIndex((q) => q.id === id);
      let to = from + delta;
      while (to >= 0 && to < list.length && list[to].archived) to += delta;
      if (from < 0 || to < 0 || to >= list.length) return d;
      [list[from], list[to]] = [list[to], list[from]];
      return { ...d, questions: list };
    });
  };

  const duplicate = async () => {
    try {
      const id = await duplicateForm(form);
      router.push(paths.adminForm(id));
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    }
  };

  const archive = async () => {
    try {
      await archiveForm(form);
      router.push(paths.adminForms());
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    }
  };

  return (
    <>
      <PageHeader
        // Le formulaire d'un evenement se regle depuis sa page : on y revient (a la liste si l'evenement est archive).
        back={event ? { href: paths.adminEvent(event.id), label: event.name } : { href: paths.adminForms(), label: "Forms" }}
        title={draft.title || "Untitled form"}
        subtitle={[
          FORM_KIND_LABELS[form.kind],
          isPublished ? `version ${form.version}` : "draft, never published",
          // L'etat du lien, pas seulement le statut : publie mais pas encore ouvert = programme.
          formState(form, new Date().toISOString()) === "not_open_yet" && form.opensDateISOString
            ? `scheduled, opens ${formatDateTime(form.opensDateISOString)}`
            : form.status === "open"
              ? "open"
              : form.status === "closed"
                ? "closed"
                : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      {isPublished && (
        <Section title="Status" hint="A closed form no longer accepts answers.">
          <SegmentedControl
            fullWidth
            value={draft.status === "draft" ? "open" : draft.status}
            onChange={(v) => set("status", v as Form["status"])}
            data={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ]}
          />
        </Section>
      )}

      {form.identityCheck === "jury_link" ? (
        <Section title="Jury link" hint="The jury link carries a secret: copy it, or make a new one, from the event's page (Admin > Events).">
          <Empty>Scores are locked by closing this form.</Empty>
        </Section>
      ) : (
        <PublicLinkSection formId={form.id} isPublished={isPublished} needsAccount={needsAccount(form.identityCheck)} />
      )}

      {isPublished && <FormResponses />}

      <Section title="Form">
        <Stack>
          <TextInput label="Title" value={draft.title} onChange={(e) => set("title", e.currentTarget.value)} />
          <Textarea
            label="Description"
            autosize
            minRows={2}
            value={draft.description ?? ""}
            onChange={(e) => set("description", e.currentTarget.value || null)}
          />
          <Select
            label="Type"
            allowDeselect={false}
            value={draft.kind}
            onChange={(v) => v && set("kind", v as FormKind)}
            data={Object.entries(FORM_KIND_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Select
            label="Event"
            description="Submission, peer rating, jury, picks, retro or feedback: the answers are tied to this event, its teams and its teams scored."
            clearable
            searchable
            value={draft.eventId}
            onChange={(v) => set("eventId", v)}
            data={events.map((e) => ({ value: e.id, label: `${e.name} · ${formatDateTime(e.startDateISOString)}` }))}
          />
        </Stack>
      </Section>

      <Section title="Respondent" hint={IDENTITY_HINTS[draft.identityCheck]}>
        <SegmentedControl
          fullWidth
          value={draft.identityCheck === "email_code" ? "account" : draft.identityCheck}
          onChange={(v) => set("identityCheck", v as FormIdentityCheck)}
          data={IDENTITY_OPTIONS}
        />
      </Section>

      <Section title="Database writes" hint="Questions linked to a field write their answer into the founder or startup record.">
        <Select
          allowDeselect={false}
          value={draft.approval}
          onChange={(v) => v && set("approval", v as FormApproval)}
          data={APPROVAL_OPTIONS}
        />
      </Section>

      <Section
        title="Schedule"
        hint="One form per occurrence. A weekly form writes to the week it opens: for next week, duplicate it."
      >
        <Stack>
          <TextInput
            label="Opens"
            type="datetime-local"
            value={toLocalInput(draft.opensDateISOString)}
            onChange={(e) => set("opensDateISOString", fromLocalInput(e.currentTarget.value))}
          />
          <TextInput
            label="Deadline"
            type="datetime-local"
            value={toLocalInput(draft.deadlineDateISOString)}
            onChange={(e) => set("deadlineDateISOString", fromLocalInput(e.currentTarget.value))}
          />
        </Stack>
      </Section>

      <Section
        title={`Questions · ${active.length}`}
        hint={archivedCount > 0 ? `${archivedCount} archived ${archivedCount === 1 ? "question is" : "questions are"} kept for past answers.` : undefined}
        right={
          <Button variant="subtle" size="compact-sm" onClick={() => setEditing({ original: null, index: draft.questions.length })}>
            Add question
          </Button>
        }
      >
        {active.length === 0 ? (
          <Empty>No question yet.</Empty>
        ) : (
          <RowList>
            {active.map(({ q }, i) => (
              <ButtonRow
                key={q.id}
                onClick={() => setEditing({ original: q, index: i })}
                title={`${i + 1}. ${q.label || "Untitled question"}`}
                subtitle={[
                  FORM_FIELD_TYPE_LABELS[q.type],
                  scopeOf(q) !== "self" ? SCOPE_LABELS[scopeOf(q)].toLowerCase() : null,
                  q.required ? "required" : null,
                  q.dbField ? `writes ${fieldName(q)}` : "not linked",
                  q.weight ? `weight ${q.weight}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                meta={
                  questionProblems(q).length > 0 ? (
                    <Text size="sm" c="red.4" fw={600}>
                      Fix
                    </Text>
                  ) : undefined
                }
              />
            ))}
          </RowList>
        )}
      </Section>

      <Section title="Actions">
        <RowList>
          <ButtonRow
            onClick={duplicate}
            title="Duplicate"
            subtitle={
              form.attachments.week
                ? "Next week's draft: same questions, dates moved by a week"
                : "A new draft with the same questions, without dates"
            }
          />
          <ButtonRow onClick={() => setConfirmArchive(true)} title="Archive" subtitle="Closes the form and hides it from the lists" />
        </RowList>
      </Section>

      <Box className="savebar">
        {isBehind && isDirty && (
          <Box mb="sm">
            <Text size="sm" fw={600}>
              Updated by someone else while you were editing.
            </Text>
            <Text size="sm" c="dimmed">
              {conflicts.length > 0
                ? `You both changed: ${conflicts.join(", ")}. Saving keeps your version of ${conflicts.length === 1 ? "it" : "them"}, and their other changes.`
                : "Your changes are kept. Saving adds them to theirs."}
            </Text>
            <Group grow gap="xs" mt={6}>
              <Button variant="default" onClick={loadTheirs}>
                Load their version
              </Button>
              <Button variant="default" onClick={keepMine}>
                Keep my changes
              </Button>
            </Group>
          </Box>
        )}
        {problems.length > 0 && (
          <Text size="sm" c="red.4" mb={6}>
            {problems[0]}
          </Text>
        )}
        {isPublished ? (
          <Button size="md" fullWidth disabled={!isDirty || problems.length > 0} loading={isSaving} onClick={() => requestSave(false)}>
            {!isDirty ? "No changes" : saveLabel}
          </Button>
        ) : (
          <Group grow gap="xs">
            <Button size="md" variant="default" disabled={!isDirty} loading={isSaving} onClick={() => save(false)}>
              {isDirty ? "Save draft" : "Saved"}
            </Button>
            <Button size="md" disabled={problems.length > 0 || active.length === 0 || isSaving} onClick={() => requestSave(true)}>
              Publish
            </Button>
          </Group>
        )}
        {!isPublished && (
          <Text size="xs" c="dimmed" ta="center" mt={6}>
            Publishing opens the public link and lists the form in the founders&apos; To do.
          </Text>
        )}
      </Box>

      {editing && (
        <QuestionModal
          key={editing.original?.id ?? "new"}
          original={editing.original}
          isPublished={editing.original ? isPublishedQuestion(editing.original) : false}
          isIndicatorLocked={editing.original ? isIndicatorLocked(editing.original) : false}
          onClose={() => setEditing(null)}
          onApply={(edited) => applyQuestion(editing.original, edited)}
          onRemove={() => editing.original && removeQuestion(editing.original)}
          onMove={(delta) => editing.original && moveQuestion(editing.original.id, delta)}
        />
      )}

      <ArchiveDialog what="form" opened={confirmArchive} onClose={() => setConfirmArchive(false)} onArchive={() => void archive()}>
        The form closes and leaves the lists. Its answers and versions are kept.
      </ArchiveDialog>

      <ResponsiveDialog
        opened={confirmSave !== null}
        onClose={() => setConfirmSave(null)}
        title={confirmSave?.publish ? "Publish this form?" : willBumpVersion ? `Publish version ${form.version + 1}?` : "Save these changes?"}
      >
        <Stack>
          {confirmSave && saveWarnings(confirmSave.publish).map((w) => (
            <Text key={w} size="sm">
              {w}
            </Text>
          ))}
          <Button size="md" fullWidth loading={isSaving} onClick={() => confirmSave && save(confirmSave.publish)}>
            {confirmSave?.publish ? "Publish" : saveLabel}
          </Button>
        </Stack>
      </ResponsiveDialog>
    </>
  );
}

// ---- Une question -------------------------------------------------------------------

function QuestionModal({
  original,
  isPublished,
  isIndicatorLocked,
  onClose,
  onApply,
  onRemove,
  onMove,
}: {
  original: FormQuestion | null;
  isPublished: boolean;
  isIndicatorLocked: boolean;
  onClose: () => void;
  onApply: (q: FormQuestion) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const { forms } = useAdmin();
  const [q, setQ] = useState<FormQuestion>(() => original ?? blankQuestion());
  // Une nouvelle cle de famille, en cours de saisie (`null` : une cle existante, ou un autre champ).
  const [newFamily, setNewFamily] = useState<{ family: FieldFamily; key: string } | null>(null);
  const set = <K extends keyof FormQuestion>(key: K, value: FormQuestion[K]) => setQ((x) => ({ ...x, [key]: value }));
  // Une cle invalide n'est pas encore un champ : la question reste sans champ tant qu'elle ne l'est pas.
  const badKey = newFamily !== null && !FAMILY_KEY.test(newFamily.key);
  const withKey = newFamily && !badKey ? { ...q, dbField: `${newFamily.family}.${newFamily.key}` as DbFieldKey } : q;
  const aligned = alignQuestionWithField(withKey);
  const problems = [...(badKey ? ["A key is a word in camelCase starting with a letter, e.g. callsMade."] : []), ...questionProblems(aligned)];
  const fieldValue = q.dbField ? getFieldDef(q.dbField).value : null;
  const optionsFromField = fieldValue !== null && (fieldValue.kind === "enum" || fieldValue.kind === "enumMulti" || fieldValue.kind === "boolean");

  // Les cles connues de chaque famille : le dictionnaire standard, celles des modeles
  // d'evenements, puis celles des formulaires du batch (sauf une ancienne cle renommee).
  const known = useMemo(() => {
    const out: Record<FieldFamily, Map<string, string>> = { "submission.metrics": new Map(), "evaluation.scores": new Map() };
    for (const [key, m] of Object.entries(STANDARD_METRICS)) out["submission.metrics"].set(key, m.label);
    for (const t of Object.values(EVENT_TEMPLATES)) {
      for (const m of t.metrics) out["submission.metrics"].set(m.key, m.label);
      for (const c of t.criteria) out["evaluation.scores"].set(c.key, c.label);
    }
    for (const f of forms) {
      for (const x of f.questions) {
        const family = x.dbField ? familyOf(x.dbField) : null;
        const legacy = family?.family === "submission.metrics" && family.key in EVENT_METRIC_RENAMES;
        if (family && !legacy && !out[family.family].has(family.key)) out[family.family].set(family.key, x.label);
      }
    }
    return out;
  }, [forms]);

  const fieldData = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const key of compatibleDbFields(q.type)) {
      const group = DOC_KIND_LABELS[parseDbField(key).doc];
      const def = getFieldDef(key);
      const items = groups.get(group) ?? [];
      items.push({ value: key, label: `${def.label}${def.indicator ? " (indicator)" : ""}${isFormOnly(parseDbField(key).doc) ? " (private)" : ""}` });
      groups.set(group, items);
    }
    const ownFamily = q.dbField ? familyOf(q.dbField) : null;
    for (const family of Object.keys(FAMILY_CHOICES) as FieldFamily[]) {
      const choice = FAMILY_CHOICES[family];
      if (FAMILY_QUESTION_TYPE[family] !== q.type) continue;
      const items = [...known[family]].map(([key, label]) => ({ value: `${family}.${key}`, label: `${label} (${key})` }));
      // La cle de la question, si elle n'est pas encore connue (ajoutee dans cette fenetre).
      const current = ownFamily?.family === family ? ownFamily.key : null;
      if (current && !known[family].has(current)) items.unshift({ value: q.dbField!, label: `${q.label || current} (${current})` });
      items.push({ value: NEW_KEY(family), label: `New ${choice.noun}...` });
      groups.set(choice.group, items);
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }, [q.type, q.dbField, q.label, known]);

  const chooseField = (value: string | null) => {
    const family = (Object.keys(FAMILY_CHOICES) as FieldFamily[]).find((f) => value === NEW_KEY(f));
    if (family) {
      const key = keyFromLabel(q.label || FAMILY_CHOICES[family].noun);
      // « Cold calls » -> `callsMade` : une metrique deja connue sous une autre cle prend la cle standard.
      setNewFamily({ family, key: family === "submission.metrics" ? standardEventMetricKey(key) : key });
      return;
    }
    setNewFamily(null);
    set("dbField", (value as DbFieldKey | null) ?? null);
  };

  const changeType = (type: FormFieldType) =>
    setQ((x) => {
      const family = x.dbField ? familyOf(x.dbField) : null;
      return {
      ...x,
      type,
      // Un champ incompatible avec le nouveau type est retire.
      dbField: x.dbField && (family ? FAMILY_QUESTION_TYPE[family.family] === type : compatibleDbFields(type).includes(x.dbField)) ? x.dbField : null,
      scale: type === "rating" ? (x.scale ?? { min: 1, max: 5 }) : null,
      options: type === "single_choice" || type === "multiple_choice" ? (x.options ?? []) : null,
      picker: type === "entity_picker" ? (x.picker ?? { entity: "founder", maxItems: 1 }) : null,
      };
    });

  return (
    <ResponsiveDialog
      opened
      onClose={onClose}
      title={original ? "Edit question" : "New question"}
      size="lg"
      // « Apply » reste a portee, meme quand la fenetre defile (feuille du bas sur mobile).
      footer={
        <Stack gap="xs">
          {problems.map((p) => (
            <Text key={p} size="sm" c="red.4">
              {p}
            </Text>
          ))}
          <Button size="md" fullWidth disabled={problems.length > 0} onClick={() => onApply(withKey)}>
            {original ? "Apply" : "Add question"}
          </Button>
        </Stack>
      }
    >
      <Stack>
        <Select
          label="Answer type"
          allowDeselect={false}
          disabled={isIndicatorLocked}
          value={q.type}
          onChange={(v) => v && changeType(v as FormFieldType)}
          data={Object.entries(FORM_FIELD_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          description={isPublished && !isIndicatorLocked ? "Changing the type of a published question archives it and creates a new one." : undefined}
        />
        <TextInput label="Question" value={q.label} onChange={(e) => set("label", e.currentTarget.value)} />
        <Textarea
          label="Help text"
          autosize
          minRows={1}
          value={q.description ?? ""}
          onChange={(e) => set("description", e.currentTarget.value || null)}
        />
        <Switch label="Required" checked={q.required} onChange={(e) => set("required", e.currentTarget.checked)} />

        {(q.type === "single_choice" || q.type === "multiple_choice") &&
          (optionsFromField ? (
            <Text size="sm" c="dimmed">
              Options come from the linked field{aligned.options ? `: ${aligned.options.join(", ")}` : " (closed list)"}.
            </Text>
          ) : (
            <TagsInput label="Options" placeholder="Type and press Enter" value={q.options ?? []} onChange={(v) => set("options", v)} />
          ))}

        {q.type === "rating" && (
          <Group grow gap="xs">
            <NumberInput
              label="From"
              disabled={fieldValue?.kind === "rating"}
              value={aligned.scale?.min ?? 1}
              onChange={(v) => set("scale", { min: Number(v), max: q.scale?.max ?? 5 })}
            />
            <NumberInput
              label="To"
              disabled={fieldValue?.kind === "rating"}
              value={aligned.scale?.max ?? 5}
              onChange={(v) => set("scale", { min: q.scale?.min ?? 1, max: Number(v) })}
            />
          </Group>
        )}

        {q.type === "entity_picker" && (
          <Group grow gap="xs">
            <Select
              label="Pick a"
              allowDeselect={false}
              disabled={fieldValue?.kind === "founderRefs"}
              value={aligned.picker?.entity ?? "founder"}
              onChange={(v) => v && set("picker", { entity: v as PickerEntity, maxItems: q.picker?.maxItems ?? 1 })}
              data={PICKER_ENTITIES}
            />
            <NumberInput
              label="At most"
              min={1}
              value={q.picker?.maxItems ?? 1}
              onChange={(v) => set("picker", { entity: q.picker?.entity ?? "founder", maxItems: Math.max(1, Number(v)) })}
            />
          </Group>
        )}

        <Select
          label="Database field"
          description={
            isIndicatorLocked
              ? "This question feeds an indicator (curves, scores): its field cannot change."
              : "Where the answer is written. Leave empty to keep it as a free answer, analysed by Claude."
          }
          placeholder="Not linked"
          clearable
          searchable
          disabled={isIndicatorLocked}
          value={newFamily ? NEW_KEY(newFamily.family) : q.dbField}
          onChange={chooseField}
          data={fieldData}
          comboboxProps={{ withinPortal: true }}
        />

        {newFamily && (
          <TextInput
            label={`Key of the new ${FAMILY_CHOICES[newFamily.family].noun}`}
            description="Stable across events, to compare them: reuse the same key for the same number. camelCase, e.g. callsMade."
            value={newFamily.key}
            onChange={(e) => setNewFamily({ ...newFamily, key: e.currentTarget.value.trim() })}
          />
        )}

        {aligned.dbField ? (
          scopeOf(aligned) !== "self" && (
            <Text size="sm" c="dimmed">
              Asked for: {SCOPE_LABELS[scopeOf(aligned)].toLowerCase()} (set by the field).
            </Text>
          )
        ) : (
          <Select
            label="Asked for"
            description="A question about each teammate or each team scored is repeated for every one of them."
            allowDeselect={false}
            value={scopeOf(q)}
            onChange={(v) => v && set("scope", v as QuestionScope)}
            data={(Object.keys(SCOPE_LABELS) as QuestionScope[]).map((value) => ({ value, label: SCOPE_LABELS[value] }))}
          />
        )}

        {isJuryCriterion(aligned) && (
          <NumberInput
            label="Weight"
            description="In the jury's weighted average (the IC grid is 40 / 40 / 20)."
            min={0}
            value={q.weight ?? 1}
            onChange={(v) => set("weight", typeof v === "number" && v > 0 ? v : null)}
          />
        )}

        {q.dbField && (
          <Select
            label="Approval for this question"
            allowDeselect={false}
            value={q.requiresApproval === null ? "form" : q.requiresApproval ? "always" : "never"}
            onChange={(v) => set("requiresApproval", v === "form" ? null : v === "always")}
            data={[
              { value: "form", label: "Use the form setting" },
              { value: "always", label: "Always approve before writing" },
              { value: "never", label: "Never ask for approval" },
            ]}
          />
        )}

        {original && (
          <Group grow gap="xs">
            <Button variant="default" onClick={() => onMove(-1)}>
              Move up
            </Button>
            <Button variant="default" onClick={() => onMove(1)}>
              Move down
            </Button>
            <Button variant="default" color="red" disabled={isIndicatorLocked} onClick={onRemove}>
              {isPublished ? "Archive" : "Delete"}
            </Button>
          </Group>
        )}
      </Stack>
    </ResponsiveDialog>
  );
}

/** Le champ d'une question, tel que l'editeur le nomme : « Team metric callsMade ». */
function fieldName(q: FormQuestion): string {
  const family = q.dbField ? familyOf(q.dbField) : null;
  if (family) return `${FAMILY_CHOICES[family.family].noun} ${family.key}`;
  return q.dbField ? getFieldDef(q.dbField).label : "";
}

/** Le lien a partager (Slack) : la page publique, une question par ecran. Un brouillon s'y relit, sans prendre de reponse. */
function PublicLinkSection({ formId, isPublished, needsAccount }: { formId: string; isPublished: boolean; needsAccount: boolean }) {
  const clipboard = useClipboard({ timeout: 1500 });
  const path = paths.form(formId);
  return (
    <Section
      title="Public link"
      hint={
        !isPublished
          ? "Preview the form as founders will see it. Publish it to collect answers."
          : needsAccount
            ? "Share it on Slack. Founders sign in with their Pioneers account to answer."
            : "Share it on Slack. No account is needed to answer."
      }
    >
      <Group gap="sm">
        {isPublished && (
          <Button size="md" onClick={() => clipboard.copy(`${window.location.origin}${path}`)}>
            {clipboard.copied ? "Copied" : "Copy link"}
          </Button>
        )}
        <Button component="a" href={path} target="_blank" rel="noreferrer" variant="default" size="md">
          {isPublished ? "Open" : "Preview"}
        </Button>
      </Group>
    </Section>
  );
}
