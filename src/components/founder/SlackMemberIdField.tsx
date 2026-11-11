"use client";

import { useState } from "react";
import { Button, Group, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { Founder, WithId } from "@shared/types";
import { setFounderSlackUserId } from "@/lib/slackAdmin";

/**
 * Saisie staff de l'id Slack d'un fondateur, en attendant la synchronisation
 * automatique par email (API Slack `users.lookupByEmail`).
 */
export function SlackMemberIdField({ founder, current }: { founder: WithId<Founder>; current: string | null }) {
  const [value, setValue] = useState(current ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const dirty = (value.trim().toUpperCase() || null) !== (current ?? null);

  const save = async () => {
    setIsSaving(true);
    try {
      await setFounderSlackUserId(founder, value);
      notifications.show({ message: "Slack member ID saved" });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Group gap="xs" align="flex-end" wrap="nowrap">
      <TextInput
        style={{ flex: 1 }}
        label="Slack member ID"
        description="Staff only. In Slack: their profile, then Copy member ID."
        placeholder="U0123ABCD"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
      />
      <Button variant="default" disabled={!dirty} loading={isSaving} onClick={save}>
        Save
      </Button>
    </Group>
  );
}
