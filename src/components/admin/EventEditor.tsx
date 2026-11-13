"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Button, Group, Menu, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import { newEvent, type EventData } from "@shared/events";
import { EVENT_TEMPLATES, eventTemplateOf, templatesOfKind, type EventTemplateKey } from "@shared/presets/eventTemplates";
import { FORM_TEMPLATES } from "@shared/presets/formTemplates";
import { GENERATOR_PRESETS, GROUP_SIZES, teamSizeFor } from "@shared/teamGenerator";
import { EVENT_KINDS, type EventStatus, type MatchingMode, type PioneersEvent, type WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { useAction } from "@/hooks/useAction";
import { createEventPack, setEventArchived, setEventMatching, updateEvent } from "@/lib/eventsAdmin";
import { formatDateTime, fromLocalInput } from "@/lib/format";
import { paths } from "@/lib/paths";
import { ActionBar } from "@/components/admin/ActionBar";
import { AttendanceLinkRow } from "@/components/admin/AttendanceSheet";
import { EventResultsAdmin } from "@/components/admin/EventResultsAdmin";
import { EventSettingsFields, settingsDraftOf, settingsOf, settingsProblems, type SettingsDraft } from "@/components/admin/EventSettingsFields";
import { TEAM_TOOLS } from "@/components/admin/teamModes";
import { EVENT_KIND_LABEL, EVENT_STATUS_OPTIONS, defaultEventStart, eventLabel } from "@/components/event/eventLabels";
import { PageHeader } from "@/components/ui/PageHeader";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Admin > Events : creer un evenement, puis sa page (le point d'entree de tout
// ce qui lui est attache)
// ----------------------------
// Creer (decision du 13/11) : « Blank » ou un TEMPLATE (un pack : l'evenement,
// son matching, ses formulaires, presets/eventTemplates.ts), puis les reglages
// dans l'ordre d'un agenda (EventSettingsFields), puis « Create » : programme,
// formulaires du pack publies ; la fleche a cote cree en brouillon (formulaires
// en brouillon aussi).
//
// La page d'un evenement : ses reglages et son statut, puis ce qui lui est
// attache : presence, matching (ajouter, taille, tirer, publier), formulaires,
// classement, resultats, jury, picks (EventResultsAdmin), et l'archive.

// ---- Creer ------------------------------------------------------------------------

/** Ce que cree un pack, en clair : son matching et ses formulaires. */
function packLine(key: EventTemplateKey): string {
  const t = EVENT_TEMPLATES[key];
  const forms = t.forms.map((f) => FORM_TEMPLATES[f].label.toLowerCase());
  return [t.matching ? `${TEAM_TOOLS[t.matching.mode].title.toLowerCase()} of ${t.matching.size.max}` : null, ...forms].filter(Boolean).join(", ") || t.summary;
}

/** Un evenement neuf du batch de travail, construit en memoire, ecrit a la creation. */
export function NewEventEditor() {
  const initial = useSearchParams().get("template");
  const preset = initial && initial in EVENT_TEMPLATES ? (initial as EventTemplateKey) : null;
  // `undefined` : pas encore choisi ; `null` : a blanc.
  const [templateKey, setTemplateKey] = useState<EventTemplateKey | null | undefined>(preset ?? undefined);
  const { batch } = useAdmin();
  const back = { href: paths.adminEvents(), label: "Events" };

  if (templateKey === undefined) {
    return (
      <>
        <PageHeader back={back} title="New event" subtitle={`In ${batch.name}.`} />
        <Section title="Start from">
          <RowList>
            <ButtonRow onClick={() => setTemplateKey(null)} title="Blank" subtitle="Just the event: add a matching or forms later" />
          </RowList>
        </Section>
        {EVENT_KINDS.map((kind) => {
          const keys = templatesOfKind(kind);
          return (
            <Section key={kind} title={EVENT_KIND_LABEL[kind]}>
              <RowList>
                {keys.map((k) => (
                  <ButtonRow key={k} onClick={() => setTemplateKey(k)} title={EVENT_TEMPLATES[k].label} subtitle={packLine(k)} />
                ))}
              </RowList>
            </Section>
          );
        })}
      </>
    );
  }
  // Changer de batch repart d'un brouillon neuf (ses fondateurs, ses startups).
  return <NewEventSettings key={`${batch.id}:${templateKey ?? "blank"}`} templateKey={templateKey} onBack={() => setTemplateKey(undefined)} />;
}

function NewEventSettings({ templateKey, onBack }: { templateKey: EventTemplateKey | null; onBack: () => void }) {
  const router = useRouter();
  const { batch } = useAdmin();
  const { isBusy, run } = useAction();
  const template = eventTemplateOf(templateKey);
  const [draft, setDraft] = useState<SettingsDraft>(() =>
    settingsDraftOf(
      newEvent({
        programId: batch.programId,
        batchId: batch.id,
        templateKey,
        name: template?.label ?? "",
        startDateISOString: fromLocalInput(defaultEventStart(templateKey)) ?? new Date().toISOString(),
        status: "scheduled",
      }),
    ),
  );
  const problems = settingsProblems(draft);

  const create = async (status: EventStatus) => {
    const settings = settingsOf(draft);
    const data: EventData = {
      ...newEvent({ programId: batch.programId, batchId: batch.id, templateKey, name: settings.name, startDateISOString: settings.startDateISOString, status }),
      ...settings,
      status,
    };
    const id = await run(() => createEventPack(data), status === "draft" ? "Draft created" : "Event created");
    if (id) router.replace(paths.adminEvent(id));
  };

  return (
    <>
      <PageHeader
        back={{ href: paths.adminEvents(), label: "Events" }}
        title={template ? `New ${template.label.toLowerCase()}` : "New event"}
        subtitle={template ? `Creates the event, then ${packLine(templateKey!)}.` : "A blank event."}
      />
      <Button variant="subtle" color="gray" px={0} mb="sm" onClick={onBack}>
        Change the template
      </Button>
      <EventSettingsFields draft={draft} onChange={setDraft} canChangeBatch />
      <Box className="savebar">
        {problems[0] && (
          <Text size="sm" c="red.4" mb={6}>
            {problems[0]}
          </Text>
        )}
        <Group gap={2} wrap="nowrap" maw={560}>
          <Button size="md" style={{ flex: 1 }} loading={isBusy} disabled={problems.length > 0} onClick={() => void create("scheduled")}>
            Create
          </Button>
          <Menu position="top-end" withinPortal>
            <Menu.Target>
              <Button size="md" px="sm" aria-label="More ways to create" disabled={isBusy || problems.length > 0}>
                <IconChevronDown size={18} />
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => void create("draft")}>Create as draft (hidden from founders, forms in draft)</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Box>
    </>
  );
}

// ---- La page d'un evenement ----------------------------------------------------------

/** La page d'un evenement existant (actif ou archive). */
export function EventEditor() {
  const { event } = useAdminEvent();
  return <Hub key={event.updatedDateISOString} event={event} />;
}

function Hub({ event }: { event: WithId<PioneersEvent> }) {
  const router = useRouter();
  const { isBusy, run } = useAction();
  const [initial] = useState(() => settingsDraftOf(event));
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<EventStatus>(event.status);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const isArchived = event.archivedDateISOString !== null;
  const isDirty = status !== event.status || JSON.stringify(draft) !== JSON.stringify(initial);
  const problems = settingsProblems(draft);
  const label = eventLabel(event);

  const save = () => void run(() => updateEvent(event.id, { ...settingsOf(draft), status }), "Event saved");
  const archive = async () => {
    setConfirmArchive(false);
    if (await run(() => setEventArchived(event.id, true).then(() => true), "Event archived")) router.push(paths.adminEvents());
  };

  return (
    <>
      <PageHeader
        back={{ href: paths.adminEvents(), label: "Events" }}
        title={event.name}
        subtitle={[label, formatDateTime(event.startDateISOString), isArchived ? "Archived" : null].filter(Boolean).join(" · ")}
      />

      {isArchived ? (
        <Section title="Archived" hint="Hidden from founders, the calendar and the staff tools. Its teams, results and scores are kept.">
          <Button size="md" fullWidth maw={480} loading={isBusy} onClick={() => void run(() => setEventArchived(event.id, false), "Event restored")}>
            Restore this event
          </Button>
        </Section>
      ) : (
        <>
          <Section title="Status" hint={EVENT_STATUS_OPTIONS.find((o) => o.value === status)?.description}>
            <Select maw={480} allowDeselect={false} value={status} onChange={(v) => v && setStatus(v as EventStatus)} data={EVENT_STATUS_OPTIONS} />
          </Section>
          <Section title="Event">
            <EventSettingsFields draft={draft} onChange={setDraft} canChangeBatch={false} />
          </Section>
          <Section title="Attendance" hint="Take it before the draw and the event's forms: absent founders are left out.">
            <RowList>
              <AttendanceLinkRow eventId={event.id} />
            </RowList>
          </Section>
          <MatchingSection />
          <EventResultsAdmin />
          <Section title="Archive">
            <RowList>
              <ButtonRow onClick={() => setConfirmArchive(true)} title="Archive this event" subtitle="Hides it from founders, the calendar and the staff tools" />
            </RowList>
          </Section>
          <ActionBar label={isDirty ? "Save" : "No changes"} loading={isBusy} disabled={!isDirty || problems.length > 0} problem={isDirty ? problems[0] : null} onClick={save} />
        </>
      )}

      <ResponsiveDialog opened={confirmArchive} onClose={() => setConfirmArchive(false)} title="Archive this event?">
        <Stack>
          <Text size="sm">It leaves the lists, the founders&apos; pages and the calendar. Its teams, results and scores are kept, and you can restore it.</Text>
          <Button size="md" color="red" fullWidth onClick={() => void archive()}>
            Archive
          </Button>
        </Stack>
      </ResponsiveDialog>
    </>
  );
}

/**
 * Le matching de l'evenement (0 ou 1) : son mode (equipes ou tables), sa taille,
 * le tirage et sa page publique. Sans groupes tires, il se change ou se retire.
 */
function MatchingSection() {
  const { event, matching, teams } = useAdminEvent();
  const { isBusy, run } = useAction();
  const published = teams.filter((t) => t.publishedDateISOString !== null);
  const add = (mode: MatchingMode) =>
    void run(() => setEventMatching(event.id, { mode, size: teamSizeFor(GENERATOR_PRESETS[mode].defaultSize) }), "Matching added");

  if (!matching) {
    return (
      <Section title="Matching" hint="Groups drawn from the participants: work teams, or tables to meet new people. The submission and the peer rating need one.">
        <Group gap="xs">
          {(["challenge", "matching"] as const).map((mode) => (
            <Button key={mode} variant="default" disabled={isBusy} onClick={() => add(mode)}>
              Add {TEAM_TOOLS[mode].title.toLowerCase()}
            </Button>
          ))}
        </Group>
      </Section>
    );
  }
  const tool = TEAM_TOOLS[matching.mode];
  const otherMode: MatchingMode = matching.mode === "challenge" ? "matching" : "challenge";
  return (
    <Section title={`Matching · ${tool.title}`} hint={tool.summary}>
      <Stack gap="sm" maw={480}>
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            {tool.groupLabel} size
          </Text>
          <SegmentedControl
            fullWidth
            disabled={isBusy}
            value={String(matching.size.max)}
            onChange={(v) => void run(() => setEventMatching(event.id, { ...matching, size: teamSizeFor(Number(v)) }), "Size saved")}
            data={GROUP_SIZES}
          />
        </Stack>
        <RowList>
          <LinkRow
            href={paths.adminEventMatching(event.id)}
            title={published.length ? `${published.length} ${tool.groupWord}s published` : teams.length ? "Draft draw" : `Draw the ${tool.groupWord}s`}
            subtitle={published.length ? "See them, enter results" : "Draw from the participants, adjust, publish"}
          />
          {published.length > 0 && <LinkRow href={paths.groups(event.id)} title="Public page" subtitle={`Anyone with the link finds their ${tool.groupWord}`} />}
        </RowList>
        {teams.length === 0 && (
          <Group gap="xs">
            <Button variant="subtle" color="gray" disabled={isBusy} onClick={() => void run(() => setEventMatching(event.id, { ...matching, mode: otherMode }), "Matching changed")}>
              Switch to {TEAM_TOOLS[otherMode].title.toLowerCase()}
            </Button>
            <Button variant="subtle" color="gray" disabled={isBusy} onClick={() => void run(() => setEventMatching(event.id, null), "Matching removed")}>
              Remove the matching
            </Button>
          </Group>
        )}
        {teams.length > 0 && published.length === 0 && <Empty>The draw is saved as a draft: publish it from the draw page.</Empty>}
      </Stack>
    </Section>
  );
}
