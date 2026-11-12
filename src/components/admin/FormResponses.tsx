"use client";

import { useMemo, useState } from "react";
import { Button, Group, Progress, Select, Stack, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { enumOptions, getFieldDef, type DbFieldKey } from "@shared/fieldRegistry";
import { formAudience, parisMonday, responseProgress, type AudienceBasis } from "@shared/formRules";
import type { FieldWrite, FormAnswer, FormQuestion, FormResponse, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminForm } from "@/context/AdminFormContext";
import { call } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatDay } from "@/lib/format";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Reponses d'un formulaire (staff)
// ----------------------------
// En tete, l'avancement pour relancer : « 12 / 30 » parmi ceux qui DEVAIENT
// repondre (`formAudience` : presents a la seance, equipes, invites ou batch),
// repondants distincts, sur la semaine en cours pour un formulaire recurrent
// (`responseProgress`). Puis les retardataires, a copier dans Slack.
// Enfin chaque reponse : ses reponses en clair, ce qu'elle a ecrit dans la
// base, et les valeurs en attente a valider ou refuser.

const BASIS_LABEL: Record<AudienceBasis, (eventName: string) => string> = {
  batch: () => "founders of the batch",
  present: (e) => `present at ${e}`,
  teams: (e) => `team members of ${e}`,
  invited: (e) => `invited to ${e}`,
};

const RESPONSE_STATUS: Record<FormResponse["status"], string> = {
  processed: "Done",
  pending_approval: "To review",
  partially_rejected: "Partly rejected",
};

const WRITE_STATUS: Record<FieldWrite["status"], string> = {
  applied: "Written",
  pending_approval: "To review",
  rejected: "Rejected",
  unchanged: "Unchanged",
  invalid: "Invalid",
};

export function FormResponses() {
  const { form, responses, attendance, teams, isResponsesLoading } = useAdminForm();
  const { founders, foundersById, eventsById } = useAdmin();
  const clipboard = useClipboard({ timeout: 1500 });
  const [openId, setOpenId] = useState<string | null>(null);

  const event = form.eventId ? (eventsById.get(form.eventId) ?? null) : null;
  const audience = useMemo(
    () => formAudience({ identityCheck: form.identityCheck, founders, event, attendance, teams }),
    [form.identityCheck, founders, event, attendance, teams],
  );

  // Formulaire recurrent : une periode par semaine (lundi a Paris), la semaine en cours par defaut.
  const isRecurring = form.recurrenceRule !== null;
  const weeks = useMemo(() => {
    const all = new Set([parisMonday(new Date().toISOString()), ...responses.map((r) => parisMonday(r.submittedDateISOString))]);
    return [...all].sort().reverse();
  }, [responses]);
  const [pickedWeek, setPickedWeek] = useState<string | null>(null);
  const weekStart = isRecurring ? (pickedWeek ?? weeks[0]) : null;

  const progress = responseProgress(audience, responses, weekStart);
  const nameOf = (founderId: string | null) => (founderId ? (foundersById.get(founderId)?.name ?? founderId) : "Anonymous");
  const opened = responses.find((r) => r.id === openId) ?? null;

  if (isResponsesLoading) return null;

  const expected = audience.kind === "founders" ? audience.founderIds.length : 0;
  return (
    <Section
      title="Responses"
      hint={
        audience.kind === "anonymous"
          ? "Anonymous form: only the number of answers is known, not who is missing."
          : `Distinct founders who answered, among the ${BASIS_LABEL[audience.basis](event?.name ?? "the event")}.`
      }
    >
      <Stack gap="md">
        {isRecurring && (
          <Select
            label="Week"
            data={weeks.map((w) => ({ value: w, label: `Week of ${formatDay(w)}` }))}
            value={weekStart}
            onChange={setPickedWeek}
            allowDeselect={false}
            maw={320}
          />
        )}

        {audience.kind === "anonymous" ? (
          <Text size="xl" fw={600} className="num">
            {progress.responses} {progress.responses === 1 ? "answer" : "answers"}
          </Text>
        ) : (
          <Stack gap={6}>
            <Text size="xl" fw={600} className="num">
              {progress.answered.length} / {expected}
              <Text span size="sm" c="dimmed" fw={400} ml="xs">
                {BASIS_LABEL[audience.basis](event?.name ?? "the event")}
              </Text>
            </Text>
            <Progress value={expected ? (progress.answered.length / expected) * 100 : 0} size="sm" />
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
            <Text size="sm">{progress.missing.map(nameOf).join(", ")}</Text>
            <Group>
              <Button variant="default" size="md" onClick={() => clipboard.copy(progress.missing.map(nameOf).join(", "))}>
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
                title={nameOf(r.respondentFounderId)}
                subtitle={`${formatDateTime(r.submittedDateISOString)} · version ${r.formVersion}`}
                meta={
                  <Text size="sm" c={r.status === "pending_approval" ? "pioneers" : "dimmed"}>
                    {RESPONSE_STATUS[r.status]}
                  </Text>
                }
              />
            ))}
          </RowList>
        )}
      </Stack>

      <ResponsiveDialog opened={opened !== null} onClose={() => setOpenId(null)} title={opened ? nameOf(opened.respondentFounderId) : undefined}>
        {opened && <ResponseDetail response={opened} questions={form.questions} />}
      </ResponsiveDialog>
    </Section>
  );
}

/** Une reponse en clair : les reponses question par question, puis ce qu'elle ecrit dans la base. */
function ResponseDetail({ response, questions }: { response: WithId<FormResponse>; questions: FormQuestion[] }) {
  const { foundersById, eventsById } = useAdmin();
  const [busy, setBusy] = useState<number | null>(null);

  /** Une valeur lisible : noms des fondateurs et des evenements, libelles des listes fixes. */
  const format = (value: FormAnswer, dbField: DbFieldKey | null): string => {
    const labels = dbField ? new Map((enumOptions(getFieldDef(dbField).value, new Map()) ?? []).map((o) => [o.value, o.label])) : null;
    const one = (v: string | number | boolean): string => {
      if (typeof v === "boolean") return v ? "Yes" : "No";
      const text = String(v);
      return foundersById.get(text)?.name ?? eventsById.get(text)?.name ?? labels?.get(text) ?? text;
    };
    if (value === null) return "-";
    return Array.isArray(value) ? value.map(one).join(", ") : one(value);
  };

  async function decide(writeIndex: number, approve: boolean) {
    setBusy(writeIndex);
    try {
      await call("decideFormWrite")({ responseId: response.id, writeIndex, approve });
    } catch (err) {
      notifications.show({ color: "red", message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const answered = questions.filter((q) => q.id in response.answers);
  return (
    <Stack gap="lg">
      <Text size="sm" c="dimmed">
        {formatDateTime(response.submittedDateISOString)} · version {response.formVersion}
      </Text>
      <Stack gap="sm">
        {answered.map((q) => (
          <div key={q.id}>
            <Text size="sm" c="dimmed">
              {q.label}
            </Text>
            <Text style={{ whiteSpace: "pre-line" }}>{format(response.answers[q.id], q.dbField)}</Text>
          </div>
        ))}
      </Stack>

      {response.writes.length > 0 && (
        <Stack gap="sm">
          <Text fw={600}>In the database</Text>
          {response.writes.map((w, i) => (
            <div key={`${w.dbField}-${i}`}>
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Text size="sm" c="dimmed">
                  {getFieldDef(w.dbField).label}
                </Text>
                <Text size="sm" c={w.status === "pending_approval" ? "pioneers" : w.status === "invalid" ? "red" : "dimmed"}>
                  {WRITE_STATUS[w.status]}
                </Text>
              </Group>
              <Text>{format(w.value, w.dbField)}</Text>
              {w.status === "pending_approval" && (
                <>
                  {w.previousValue !== null && (
                    <Text size="sm" c="dimmed">
                      Replaces: {format(w.previousValue, w.dbField)}
                    </Text>
                  )}
                  <Group gap="sm" mt="xs">
                    <Button size="md" loading={busy === i} disabled={busy !== null} onClick={() => decide(i, true)}>
                      Approve
                    </Button>
                    <Button size="md" variant="default" disabled={busy !== null} onClick={() => decide(i, false)}>
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
            </div>
          ))}
        </Stack>
      )}

      {response.unmatched.length > 0 && (
        <Text size="sm" c="dimmed">
          {response.unmatched.length} {response.unmatched.length === 1 ? "answer is" : "answers are"} not linked to a database field. Claude can
          suggest where they belong.
        </Text>
      )}
    </Stack>
  );
}
