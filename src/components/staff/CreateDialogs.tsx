"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Group, Stack, TextInput, Textarea } from "@mantine/core";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { notifications } from "@mantine/notifications";
import { createBatch, createProgram, slugify } from "@/lib/batchAdmin";
import { paths } from "@/lib/paths";

// Creation d'un programme ou d'un batch (staff). L'id est un slug derive du nom,
// modifiable : il apparait dans les URL et ne change plus ensuite.

function useSlugField(name: string) {
  const [custom, setCustom] = useState<string | null>(null);
  return { slug: custom ?? slugify(name), setSlug: (v: string) => setCustom(slugify(v) || null) };
}

export function CreateProgramButton() {
  const router = useRouter();
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
      router.push(paths.program(slug));
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

export function CreateBatchButton({ programId }: { programId: string }) {
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const { slug, setSlug } = useSlugField(name);
  const [isSaving, setIsSaving] = useState(false);
  const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

  const submit = async () => {
    setIsSaving(true);
    try {
      await createBatch({ id: slug, programId, name: name.trim(), startDayString: start, endDayString: end || null });
      setOpened(false);
      router.push(paths.batch(programId, slug));
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
            <Button size="md" disabled={!name.trim() || !slug || !isDay(start)} loading={isSaving} onClick={submit}>
              Create
            </Button>
          </Group>
        </Stack>
      </ResponsiveDialog>
    </>
  );
}
