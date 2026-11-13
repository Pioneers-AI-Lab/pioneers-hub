"use client";

import { useState } from "react";
import { Button, Collapse, Group, MultiSelect, Select, Stack, Switch, TextInput, Textarea } from "@mantine/core";
import { endAfter, guestCopiesOf } from "@shared/events";
import { normalizeHttpUrl } from "@shared/text";
import type { EventAudience, EventGuest, PioneersEvent } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import type { EventSettings } from "@/lib/eventsAdmin";

// ----------------------------
// Les reglages d'un evenement, dans l'ordre d'un agenda (decision du 13/11)
// ----------------------------
// Nom ; debut | duree | fin ; invites (le batch et / ou des personnes, comme
// les invites de Google Calendar). Replies : lieu, description, jalon, lien
// d'inscription, ressource. Les memes champs a la creation et sur la page d'un
// evenement. Ni semaine du programme, ni taille d'equipe (dans le matching), ni
// metriques (dans le Debrief).

export type SettingsDraft = {
  name: string;
  start: string;
  end: string;
  audience: EventAudience;
  guests: EventGuest[];
  startupIds: string[];
  topic: string;
  location: string;
  isMilestone: boolean;
  signUpUrl: string;
  resourceUrl: string;
};

export const settingsDraftOf = (e: Pick<PioneersEvent, keyof EventSettings>): SettingsDraft => ({
  name: e.name,
  start: toLocalInput(e.startDateISOString),
  end: toLocalInput(e.endDateISOString),
  audience: e.audience,
  guests: e.guests,
  startupIds: e.startupIds,
  topic: e.topic ?? "",
  location: e.location ?? "",
  isMilestone: e.isMilestone,
  signUpUrl: e.signUpUrl ?? "",
  resourceUrl: e.resourceUrl ?? "",
});

const link = (value: string) => (value.trim() ? normalizeHttpUrl(value) : null);

/** Ce qui empeche d'enregistrer, le premier d'abord. */
export function settingsProblems(d: SettingsDraft): string[] {
  const start = fromLocalInput(d.start);
  const end = fromLocalInput(d.end);
  return [
    !d.name.trim() && "Give the event a name.",
    !start && "Set when it starts.",
    start && end && end <= start && "It must end after it starts.",
    d.audience === "guests" && d.guests.length === 0 && d.startupIds.length === 0 && "Invite the batch or at least one guest.",
    d.signUpUrl.trim() && !link(d.signUpUrl) && "The sign-up link is not a web address.",
    d.resourceUrl.trim() && !link(d.resourceUrl) && "The resource link is not a web address.",
  ].filter((p): p is string => Boolean(p));
}

/** Les reglages a ecrire, tires du brouillon (les copies d'invites suivent `guests`). */
export function settingsOf(d: SettingsDraft): Omit<EventSettings, "status"> {
  const start = fromLocalInput(d.start) ?? new Date().toISOString();
  return {
    name: d.name.trim(),
    topic: d.topic.trim() || null,
    startDateISOString: start,
    endDateISOString: fromLocalInput(d.end),
    location: d.location.trim() || null,
    isMilestone: d.isMilestone,
    signUpUrl: link(d.signUpUrl),
    resourceUrl: link(d.resourceUrl),
    audience: d.audience,
    guests: d.guests,
    ...guestCopiesOf(d.guests),
    startupIds: d.startupIds,
  };
}

// ---- Duree --------------------------------------------------------------------------

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];
const durationLabel = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`);
const CUSTOM = "custom";

const minutesBetween = (start: string, end: string) => {
  const a = fromLocalInput(start);
  const b = fromLocalInput(end);
  return a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60_000) : null;
};
const addMinutes = (start: string, minutes: number) => {
  const a = fromLocalInput(start);
  return a ? toLocalInput(endAfter(a, minutes)) : "";
};

// ---- Les champs -------------------------------------------------------------------------

export function EventSettingsFields({
  draft,
  onChange,
  canChangeBatch,
}: {
  draft: SettingsDraft;
  onChange: (next: SettingsDraft) => void;
  /** A la creation : le batch se choisit parmi les invites (il bascule le batch de travail). */
  canChangeBatch: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(Boolean(draft.topic || draft.location || draft.signUpUrl || draft.resourceUrl || draft.isMilestone));
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => onChange({ ...draft, [key]: value });
  const minutes = minutesBetween(draft.start, draft.end);
  const durationValue = minutes !== null && DURATIONS.includes(minutes) ? String(minutes) : CUSTOM;

  return (
    <Stack gap="md" maw={560}>
      <TextInput label="Name" placeholder="Add a title" size="lg" value={draft.name} onChange={(e) => set("name", e.currentTarget.value)} />
      <Group grow align="flex-end" gap="xs" wrap="wrap">
        <TextInput
          label="Starts"
          type="datetime-local"
          value={draft.start}
          // La duree reste : la fin suit le debut.
          onChange={(e) => {
            const start = e.currentTarget.value;
            onChange({ ...draft, start, end: minutes !== null && minutes > 0 ? addMinutes(start, minutes) : draft.end });
          }}
          miw={190}
        />
        <Select
          label="Duration"
          allowDeselect={false}
          value={durationValue}
          onChange={(v) => v && v !== CUSTOM && set("end", addMinutes(draft.start, Number(v)))}
          data={[...DURATIONS.map((m) => ({ value: String(m), label: durationLabel(m) })), ...(durationValue === CUSTOM ? [{ value: CUSTOM, label: minutes && minutes > 0 ? durationLabel(minutes) : "Custom" }] : [])]}
          miw={110}
        />
        <TextInput label="Ends" type="datetime-local" value={draft.end} onChange={(e) => set("end", e.currentTarget.value)} miw={190} />
      </Group>
      <GuestsField draft={draft} onChange={onChange} canChangeBatch={canChangeBatch} />

      <div>
        <Button variant="subtle" color="gray" px={0} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
          {moreOpen ? "Fewer options" : "More options: location, description, links"}
        </Button>
        <Collapse expanded={moreOpen}>
          <Stack gap="md" pt="xs">
            <TextInput label="Location" placeholder="Station F" value={draft.location} onChange={(e) => set("location", e.currentTarget.value)} />
            <Textarea label="Description" autosize minRows={2} placeholder="What the event is about" value={draft.topic} onChange={(e) => set("topic", e.currentTarget.value)} />
            <Switch size="md" label="Batch milestone" description="Flagged in the Slack summaries" checked={draft.isMilestone} onChange={(e) => set("isMilestone", e.currentTarget.checked)} />
            <TextInput label="Sign-up link" placeholder="https://" value={draft.signUpUrl} onChange={(e) => set("signUpUrl", e.currentTarget.value)} />
            <TextInput label="Resource link" placeholder="Slides, brief, recording" value={draft.resourceUrl} onChange={(e) => set("resourceUrl", e.currentTarget.value)} />
          </Stack>
        </Collapse>
      </div>
    </Stack>
  );
}

/**
 * Les invites, en puces comme un agenda : le batch (tous ses fondateurs), des
 * fondateurs, des startups (leurs membres), et des invites exterieurs saisis.
 * Sans le batch, seuls les invites voient l'evenement (`audience: guests`).
 */
function GuestsField({ draft, onChange, canChangeBatch }: { draft: SettingsDraft; onChange: (next: SettingsDraft) => void; canChangeBatch: boolean }) {
  const { batch, batches, selectBatch, founders, foundersById, startups } = useAdmin();
  const [external, setExternal] = useState("");

  const batchValue = `batch:${batch.id}`;
  const value = [
    ...(draft.audience === "batch" ? [batchValue] : []),
    // Les mentors invites (par l'API) ne sont pas dans la liste : ils sont gardes a part.
    ...draft.guests.flatMap((g) => (g.mentorId ? [] : [g.founderId ? `founder:${g.founderId}` : `guest:${g.name}`])),
    ...draft.startupIds.map((id) => `startup:${id}`),
  ];
  const externals = draft.guests.filter((g) => !g.founderId && !g.mentorId);
  const data = [
    { group: "Batch", items: (canChangeBatch ? batches : [batch]).map((b) => ({ value: `batch:${b.id}`, label: `${b.name} · all founders` })) },
    { group: "Founders", items: founders.map((f) => ({ value: `founder:${f.id}`, label: f.name })) },
    { group: "Startups", items: startups.map((s) => ({ value: `startup:${s.id}`, label: `${s.name} · its members` })) },
    ...(externals.length ? [{ group: "Guests", items: externals.map((g) => ({ value: `guest:${g.name}`, label: g.name })) }] : []),
  ];

  const change = (next: string[]) => {
    // Un autre batch choisi (creation) : le batch de travail bascule, ses fondateurs suivent.
    const otherBatch = next.find((v) => v.startsWith("batch:") && v !== batchValue);
    if (otherBatch) return selectBatch(otherBatch.slice("batch:".length));
    const guests: EventGuest[] = next.flatMap((v): EventGuest[] => {
      if (v.startsWith("founder:")) {
        const id = v.slice("founder:".length);
        const f = foundersById.get(id);
        return [{ name: f?.name ?? id, role: "founder", personId: f?.personId ?? null, founderId: id, mentorId: null, intro: null }];
      }
      if (v.startsWith("guest:")) return draft.guests.filter((g) => !g.founderId && `guest:${g.name}` === v);
      return [];
    });
    const mentors = draft.guests.filter((g) => g.mentorId);
    onChange({
      ...draft,
      audience: next.includes(batchValue) ? "batch" : "guests",
      guests: [...guests, ...mentors],
      startupIds: next.filter((v) => v.startsWith("startup:")).map((v) => v.slice("startup:".length)),
    });
  };

  const addExternal = () => {
    const name = external.trim();
    if (!name || draft.guests.some((g) => g.name === name)) return;
    onChange({ ...draft, guests: [...draft.guests, { name, role: "guest", personId: null, founderId: null, mentorId: null, intro: null }] });
    setExternal("");
  };

  return (
    <Stack gap={6}>
      <MultiSelect
        label="Guests"
        description="The whole batch, or only some founders, startups and guests: only they see the event."
        placeholder={value.length ? undefined : "Add guests"}
        searchable
        data={data}
        value={value}
        onChange={change}
        comboboxProps={{ withinPortal: true }}
      />
      <TextInput
        aria-label="Add an outside guest"
        placeholder="Outside guest: type a name, then Enter"
        value={external}
        onChange={(e) => setExternal(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          addExternal();
        }}
      />
    </Stack>
  );
}
