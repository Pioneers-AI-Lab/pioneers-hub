"use client";

import { Button, Group, Progress, Stack, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { SubsectionTitle } from "@/components/ui/Section";

// ----------------------------
// L'avancement « qui l'a fait » (staff), pour relancer
// ----------------------------
// « 12 / 30 » parmi les attendus, une barre, puis les retardataires a copier
// dans Slack, puis ceux qui l'ont fait (si `doneTitle`). Sert a Admin > Tasks et
// au suivi d'un formulaire (FormResponses, avec `outsideNote`).

export function CompletionProgress({
  doneNames,
  missingNames,
  basisLabel,
  missingTitle,
  doneTitle,
  outsideNote,
}: {
  doneNames: string[];
  missingNames: string[];
  /** Sur quoi porte le total (« founders of the batch »). */
  basisLabel: string;
  /** « Not done yet » ; suivi du nombre. */
  missingTitle: string;
  /** Absent : la liste de ceux qui l'ont fait n'est pas montree. */
  doneTitle?: string;
  /** Une phrase sur ceux qui l'ont fait hors des attendus (parti, absent) : hors du taux. */
  outsideNote?: string;
}) {
  const clipboard = useClipboard({ timeout: 1500 });
  const total = doneNames.length + missingNames.length;
  const missing = missingNames.join(", ");
  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Text size="xl" fw={600} className="num">
          {doneNames.length} / {total}
          <Text span size="sm" c="dimmed" fw="var(--mantine-font-weight-regular)" ml="xs">
            {basisLabel}
          </Text>
        </Text>
        <Progress value={total ? (doneNames.length / total) * 100 : 0} size="sm" />
        {outsideNote && (
          <Text size="sm" c="dimmed">
            {outsideNote}
          </Text>
        )}
      </Stack>
      {missingNames.length > 0 && (
        <Stack gap="xs">
          <SubsectionTitle>
            {missingTitle} ({missingNames.length})
          </SubsectionTitle>
          <Text size="sm">{missing}</Text>
          <Group>
            <Button variant="default" size="md" onClick={() => clipboard.copy(missing)}>
              {clipboard.copied ? "Copied" : "Copy names"}
            </Button>
          </Group>
        </Stack>
      )}
      {doneTitle && doneNames.length > 0 && (
        <Stack gap="xs">
          <SubsectionTitle>
            {doneTitle} ({doneNames.length})
          </SubsectionTitle>
          <Text size="sm" c="dimmed">
            {doneNames.join(", ")}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
