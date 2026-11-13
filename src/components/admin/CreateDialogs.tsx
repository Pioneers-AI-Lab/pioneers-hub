"use client";

import { useState } from "react";
import { Button, Group, Select, Stack, TextInput, Textarea } from "@mantine/core";
import type { Program, WithId } from "@shared/types";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { notifications } from "@mantine/notifications";
import { createBatch, createProgram, slugify } from "@/lib/batchAdmin";

// Creation d'un programme ou d'un batch (Admin > Batch settings, ou l'admin
// vide). L'id est un slug derive du nom, modifiable : il apparait dans les URL
// et ne change plus ensuite. Rien ne navigue : un nouveau batch devient le
// batch de travail de l'admin (`onCreated`).

function useSlugField(name: string) {
  const [custom, setCustom] = useState<string | null>(null);
  return { slug: custom ?? slugify(name), setSlug: (v: string) => setCustom(slugify(v) || null) };
}

export function CreateProgramButton() {
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { slug, setSlug } = useSlugField(name);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    setIsSaving(true);
    try {
      await createProgram({ id: slug, name: name.trim(), description: description.trim() || null });
      setOpened(false);
      notifications.show({ message: `${name.trim()} is created: add its first batch.` });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Button variant="default" onClick={() => setOpened(true)}>
        New program
      </Button>
      <ResponsiveDialog opened={opened} onClose={() => setOpened(false)} title="New program">
        <Stack>
          <TextInput label="Name" placeholder="Pioneers Accelerator" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
          <TextInput label="Id (in the URL)" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} />
          <Textarea label="Description" autosize minRows={2} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
          <Group grow>
            <Button variant="default" size="md" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={!name.trim() || !slug} loading={isSaving} onClick={submit}>
              Create
            </Button>
          </Group>
        </Stack>
      </ResponsiveDialog>
    </>
  );
}

export function CreateBatchButton({
  programs,
  defaultProgramId,
  onCreated,
}: {
  programs: WithId<Program>[];
  defaultProgramId?: string;
  onCreated: (batchId: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [programId, setProgramId] = useState<string | null>(defaultProgramId ?? programs[0]?.id ?? null);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const { slug, setSlug } = useSlugField(name);
  const [isSaving, setIsSaving] = useState(false);
  const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

  const submit = async () => {
    if (!programId) return;
    setIsSaving(true);
    try {
      await createBatch({ id: slug, programId, name: name.trim(), startDayString: start, endDayString: end || null });
      setOpened(false);
      onCreated(slug);
      notifications.show({ message: `${name.trim()} is created and selected.` });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Button variant="default" onClick={() => setOpened(true)}>
        New batch
      </Button>
      <ResponsiveDialog opened={opened} onClose={() => setOpened(false)} title="New batch">
        <Stack>
          {programs.length > 1 && (
            <Select
              label="Program"
              allowDeselect={false}
              value={programId}
              onChange={setProgramId}
              data={programs.map((p) => ({ value: p.id, label: p.name }))}
              comboboxProps={{ withinPortal: true }}
            />
          )}
          <TextInput label="Name" placeholder="Spring 2027" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
          <TextInput label="Id (in the URL)" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} />
          <Group grow align="flex-start">
            <TextInput label="Start" type="date" value={start} onChange={(e) => setStart(e.currentTarget.value)} />
            <TextInput label="End" type="date" value={end} onChange={(e) => setEnd(e.currentTarget.value)} />
          </Group>
          <Group grow>
            <Button variant="default" size="md" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={!programId || !name.trim() || !slug || !isDay(start)} loading={isSaving} onClick={submit}>
              Create
            </Button>
          </Group>
        </Stack>
      </ResponsiveDialog>
    </>
  );
}
