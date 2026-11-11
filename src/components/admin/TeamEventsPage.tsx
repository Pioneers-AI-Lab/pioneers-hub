"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, SegmentedControl, Select, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import dayjs from "dayjs";
import { EVENT_TEMPLATES, type EventTemplateKey } from "@shared/presets/eventTemplates";
import { GROUP_SIZE_MAX, GROUP_SIZE_MIN } from "@shared/teamGenerator";
import { useAdmin } from "@/context/AdminContext";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { createTeamEvent } from "@/lib/teamsAdmin";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { TEAM_TOOLS, templatesOfMode, type TeamToolMode } from "@/components/admin/teamModes";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

const SIZES = Array.from({ length: GROUP_SIZE_MAX - GROUP_SIZE_MIN + 1 }, (_, i) => String(GROUP_SIZE_MIN + i));

/** Liste des evenements de l'outil (challenges ou roulettes) et creation d'un nouveau. */
export function TeamEventsPage({ mode }: { mode: TeamToolMode }) {
  const tool = TEAM_TOOLS[mode];
  const { batch, events } = useAdmin();
  const list = events.filter((e) => e.kind === tool.kind);

  return (
    <>
      <PageHeader back={{ href: paths.admin(), label: "Admin" }} title={tool.title} subtitle={tool.subtitle} />
      <BatchPicker />
      <NewEventForm key={`${batch.id}:${list.length}`} mode={mode} count={list.length} />
      <Section title={`${tool.title} · ${list.length}`}>
        {list.length === 0 ? (
          <Empty>Nothing yet in {batch.name}. Create the first one above.</Empty>
        ) : (
          <RowList>
            {list.map((e) => (
              <LinkRow
                key={e.id}
                href={tool.eventHref(e.id)}
                title={e.name}
                subtitle={[formatDateTime(e.startDateISOString), e.location].filter(Boolean).join(" · ")}
                meta={e.teamSize ? <Text size="sm" c="dimmed" className="num">by {e.teamSize.max}</Text> : undefined}
              />
            ))}
          </RowList>
        )}
      </Section>
    </>
  );
}

function NewEventForm({ mode, count }: { mode: TeamToolMode; count: number }) {
  const tool = TEAM_TOOLS[mode];
  const router = useRouter();
  const { batch } = useAdmin();
  const templates = templatesOfMode(mode);
  const [templateKey, setTemplateKey] = useState<EventTemplateKey>(tool.defaultTemplate);
  const [name, setName] = useState(`${EVENT_TEMPLATES[tool.defaultTemplate].label} ${count + 1}`);
  const [start, setStart] = useState(
    dayjs()
      .add(1, "day")
      .hour(mode === "matching" ? 12 : 9)
      .minute(mode === "matching" ? 30 : 0)
      .format("YYYY-MM-DDTHH:mm"),
  );
  const [location, setLocation] = useState("");
  const [size, setSize] = useState(String(tool.defaultSize));
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    setIsSaving(true);
    try {
      const id = await createTeamEvent({
        programId: batch.programId,
        batchId: batch.id,
        templateKey,
        name: name.trim(),
        startDateISOString: new Date(start).toISOString(),
        location: location.trim() || null,
        teamSize: { min: Math.max(GROUP_SIZE_MIN, Number(size) - 1), max: Number(size) },
      });
      router.push(tool.eventHref(id));
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
      setIsSaving(false);
    }
  };

  return (
    <Section title="New" hint={`Creates the event in ${batch.name}, then opens the generator.`}>
      <Stack>
        {templates.length > 1 && (
          <Select
            label="Format"
            allowDeselect={false}
            value={templateKey}
            onChange={(v) => {
              if (!v) return;
              const key = v as EventTemplateKey;
              setTemplateKey(key);
              setName(`${EVENT_TEMPLATES[key].label} ${count + 1}`);
            }}
            data={templates}
          />
        )}
        <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label="Starts" type="datetime-local" value={start} onChange={(e) => setStart(e.currentTarget.value)} />
        <TextInput label="Location" placeholder="Optional" value={location} onChange={(e) => setLocation(e.currentTarget.value)} />
        <Box>
          <Text size="sm" fw={500} mb={4}>
            {tool.groupLabel} size
          </Text>
          <SegmentedControl fullWidth value={size} onChange={setSize} data={SIZES} />
        </Box>
        <Button size="md" fullWidth disabled={!name.trim() || !start} loading={isSaving} onClick={submit}>
          Create and draw
        </Button>
      </Stack>
    </Section>
  );
}
