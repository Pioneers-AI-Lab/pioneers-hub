"use client";

import { memo, useMemo, useState } from "react";
import { Button, Group, Progress, Stack, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { enumOptions, getFieldDef, listKeyOf, type DbFieldKey } from "@shared/fieldRegistry";
import { formAudience, formNeedsTeam, responseProgress, type AudienceBasis } from "@shared/formRules";
import { isPerTarget, parseAnswerKey, scopeOf, type FormAnswer, type FormQuestion, type FormResponse, type ListKey, type WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminForm } from "@/context/AdminFormContext";
import { useLists } from "@/context/ListsContext";
import { useAction } from "@/hooks/useAction";
import { call } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { RESPONSE_STATUS, WRITE_STATUS } from "@/components/admin/formLabels";
import { Field } from "@/components/ui/Field";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Reponses d'un formulaire (staff)
// ----------------------------
// En tete, l'avancement pour relancer : « 12 / 30 » parmi ceux qui DEVAIENT
// repondre (`formAudience` : presents a la seance, equipes, invites ou batch),
// repondants distincts de CE formulaire (`responseProgress`). Puis les
// retardataires, a copier dans Slack.
// Enfin chaque reponse : ses reponses en clair, ce qu'elle a ecrit dans la
// base, et les valeurs en attente a valider ou refuser.
//
// `memo` : monte dans l'editeur, le composant ne se recalcule pas a chaque
// frappe dans le titre ou une question (il ne lit que des contextes).

const BASIS_LABEL: Record<AudienceBasis, (eventName: string) => string> = {
  batch: () => "founders of the batch",
  present: (e) => `present at ${e}`,
  teams: (e) => `team members of ${e}`,
  invited: (e) => `invited to ${e}`,
};

export const FormResponses = memo(function FormResponses() {
  const { form, responses, attendance, isResponsesLoading } = useAdminForm();
  const { founders, foundersById, eventsById, teamMemberships } = useAdmin();
  const clipboard = useClipboard({ timeout: 1500 });
  const [openId, setOpenId] = useState<string | null>(null);

  const event = form.eventId ? (eventsById.get(form.eventId) ?? null) : null;
  const audience = useMemo(
    () =>
      formAudience({
        identityCheck: form.identityCheck,
        needsTeam: formNeedsTeam(form),
        batchId: form.batchId,
        founders,
        event,
        attendance,
        teamMemberIds: event ? teamMemberships.filter((m) => m.eventId === event.id).map((m) => m.founderId) : [],
      }),
    [form, founders, event, attendance, teamMemberships],
  );

  const progress = responseProgress(audience, responses);

  if (isResponsesLoading) return null;

  const nameOf = (founderId: string | null) => (founderId ? (foundersById.get(founderId)?.name ?? founderId) : "Anonymous");
  /** Le repondant d'une reponse : le fondateur, ou le jure (nom choisi ou saisi). */
  const respondentOf = (r: FormResponse) => (r.respondentFounderId ? nameOf(r.respondentFounderId) : (r.respondentName ?? "Anonymous"));
  const missingNames = progress.missing.map(nameOf).join(", ");
  const basisLabel = audience.kind === "founders" ? BASIS_LABEL[audience.basis](event?.name ?? "the event") : null;
  const opened = responses.find((r) => r.id === openId) ?? null;

  return (
    <Section
      title="Responses"
      hint={
        basisLabel
          ? `Distinct founders who answered, among the ${basisLabel}.`
          : audience.kind === "jury"
            ? "Jury form: each save of a judge is an answer. The scores themselves are on the event's page."
            : "Anonymous form: only the number of answers is known, not who is missing."
      }
    >
      <Stack gap="md">
        {audience.kind !== "founders" ? (
          <Text size="xl" fw={600} className="num">
            {progress.responses} {progress.responses === 1 ? "answer" : "answers"}
          </Text>
        ) : (
          <Stack gap={6}>
            <Text size="xl" fw={600} className="num">
              {progress.answered.length} / {audience.founderIds.length}
              <Text span size="sm" c="dimmed" fw={400} ml="xs">
                {basisLabel}
              </Text>
            </Text>
            <Progress value={audience.founderIds.length ? (progress.answered.length / audience.founderIds.length) * 100 : 0} size="sm" />
            {progress.outside.length > 0 && (
              <Text size="sm" c="dimmed">
                Also answered, outside this list: {progress.outside.map(nameOf).join(", ")}.
              </Text>
            )}
          </Stack>
        )}

        {progress.missing.length > 0 && (
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Not answered yet ({progress.missing.length})
            </Text>
            <Text size="sm">{missingNames}</Text>
            <Group>
              <Button variant="default" size="md" onClick={() => clipboard.copy(missingNames)}>
                {clipboard.copied ? "Copied" : "Copy names"}
              </Button>
            </Group>
          </Stack>
        )}

        {responses.length === 0 ? (
          <Empty>No answers yet.</Empty>
        ) : (
          <RowList>
            {responses.map((r) => (
              <ButtonRow
                key={r.id}
                onClick={() => setOpenId(r.id)}
                title={respondentOf(r)}
                subtitle={`${formatDateTime(r.submittedDateISOString)} · version ${r.formVersion}`}
                meta={
                  <Text size="sm" c={RESPONSE_STATUS[r.status].color}>
                    {RESPONSE_STATUS[r.status].label}
                  </Text>
                }
              />
            ))}
          </RowList>
        )}
      </Stack>

      <ResponsiveDialog opened={opened !== null} onClose={() => setOpenId(null)} title={opened ? respondentOf(opened) : undefined}>
        {opened && <ResponseDetail response={opened} questions={form.questions} />}
      </ResponsiveDialog>
    </Section>
  );
});

/** Une reponse en clair : les reponses question par question, puis ce qu'elle ecrit dans la base. */
function ResponseDetail({ response, questions }: { response: WithId<FormResponse>; questions: FormQuestion[] }) {
  const { foundersById, eventsById } = useAdmin();
  const { labelOf } = useLists();
  const { isBusy, run } = useAction();
  const [deciding, setDeciding] = useState<number | null>(null);

  /** Une valeur lisible : noms des fondateurs et des evenements, libelles des listes (fermees ou fixes). */
  const format = (value: FormAnswer, dbField: DbFieldKey | null): string => {
    const spec = dbField ? getFieldDef(dbField).value : null;
    const listKey = spec ? listKeyOf(spec) : null;
    const one = (v: string | number | boolean): string => {
      if (typeof v === "boolean") return v ? "Yes" : "No";
      const text = String(v);
      const named = foundersById.get(text)?.name ?? eventsById.get(text)?.name;
      if (named) return named;
      if (listKey) return labelOf(listKey as ListKey, text);
      return (spec && enumOptions(spec, new Map())?.find((o) => o.value === text)?.label) ?? text;
    };
    if (value === null) return "";
    return Array.isArray(value) ? value.map(one).join(", ") : one(value);
  };

  async function decide(writeIndex: number, approve: boolean) {
    setDeciding(writeIndex);
    await run(() => call("decideFormWrite")({ responseId: response.id, writeIndex, approve }), approve ? "Written" : "Rejected");
    setDeciding(null);
  }

  return (
    <Stack gap="lg">
      <Text size="sm" c="dimmed">
        {formatDateTime(response.submittedDateISOString)} · version {response.formVersion}
      </Text>
      <Stack gap="sm">
        {questions.flatMap((q) =>
          // Une question par cible (coequipier, equipe notee) : une ligne par cible repondue.
          Object.keys(response.answers)
            .map((key) => ({ key, ...parseAnswerKey(key) }))
            .filter((a) => a.questionId === q.id && (a.targetId !== null) === isPerTarget(scopeOf(q)))
            .map(({ key, targetId }) => {
              const target = targetId ? (response.targetNames?.[targetId] ?? foundersById.get(targetId)?.name ?? targetId) : null;
              return (
                <Field key={key} label={target ? `${q.label} · ${target}` : q.label} showEmpty>
                  {format(response.answers[key], q.dbField)}
                </Field>
              );
            }),
        )}
      </Stack>

      {response.writes.length > 0 && (
        <Stack gap="sm">
          <Text fw={600}>In the database</Text>
          {response.writes.map((w, i) => (
            <Stack key={`${w.dbField}-${i}`} gap={4}>
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <span className="label">
                  {getFieldDef(w.dbField).label}
                  {w.targetId ? ` · ${response.targetNames?.[w.targetId] ?? foundersById.get(w.targetId)?.name ?? w.targetId}` : ""}
                </span>
                <Text size="sm" c={WRITE_STATUS[w.status].color}>
                  {WRITE_STATUS[w.status].label}
                </Text>
              </Group>
              <Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {format(w.value, w.dbField)}
              </Text>
              {w.status === "pending_approval" && (
                <>
                  {w.previousValue !== null && (
                    <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                      Replaces: {format(w.previousValue, w.dbField)}
                    </Text>
                  )}
                  <Group gap="sm" mt={4}>
                    <Button size="md" loading={deciding === i} disabled={isBusy} onClick={() => decide(i, true)}>
                      Approve
                    </Button>
                    <Button size="md" variant="default" disabled={isBusy} onClick={() => decide(i, false)}>
                      Reject
                    </Button>
                  </Group>
                </>
              )}
              {w.status === "invalid" && w.reason && (
                <Text size="sm" c="dimmed">
                  {w.reason}
                </Text>
              )}
            </Stack>
          ))}
        </Stack>
      )}

      {response.unmatched.length > 0 && (
        <Text size="sm" c="dimmed">
          {response.unmatched.length} {response.unmatched.length === 1 ? "answer is" : "answers are"} not linked to a database field. Claude
          can suggest where they belong.
        </Text>
      )}
    </Stack>
  );
}
