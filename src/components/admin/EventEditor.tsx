"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Button, Group, Menu, Select, Stack, Text } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import { defaultMatching, newEvent, type EventData } from "@shared/events";
import { EVENT_TEMPLATES, eventTemplateOf, templatesOfKind, type EventTemplateKey } from "@shared/presets/eventTemplates";
import { FORM_TEMPLATES } from "@shared/presets/formTemplates";
import { GENERATOR_PRESETS } from "@shared/teamGenerator";
import { EVENT_KINDS, MATCHING_MODES, type EventStatus, type MatchingMode, type PioneersEvent, type WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { useAction } from "@/hooks/useAction";
import { createEventPack, setEventArchived, updateEvent } from "@/lib/eventsAdmin";
import { replaceMatching } from "@/lib/teamsAdmin";
import { formatDateTime, fromLocalInput } from "@/lib/format";
import { paths } from "@/lib/paths";
import { ActionBar } from "@/components/admin/ActionBar";
import { AttendanceLinkRow } from "@/components/admin/AttendanceSheet";
import { EventFormsField, EventResultsAdmin } from "@/components/admin/EventResultsAdmin";
import { EventSettingsFields, settingsDraftOf, settingsOf, settingsProblems, type SettingsDraft } from "@/components/admin/EventSettingsFields";
import { TEAM_TOOLS } from "@/components/admin/teamModes";
import { EVENT_KIND_LABEL, EVENT_STATUS_DESCRIPTION, EVENT_STATUS_OPTIONS, defaultEventStart, eventLabel } from "@/components/event/eventLabels";
import { PageHeader } from "@/components/ui/PageHeader";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, LinkRow, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";
import { HelpBlock } from "@/components/ui/useHelp";

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
// La page d'un evenement, comme un formulaire : ses reglages et son statut, puis
// ce qui lui est attache, chacun sous son libelle : presence, matching (0 ou 1,
// une ligne qui ouvre sa fenetre : le tirage, qui regle la taille et publie ; le
// type ; le retrait, jusqu'a la publication), formulaires (« Add a form » ->
// vierge ou un modele -> son editeur). Ensuite ce qui fait son resultat : classement, resultats, jury,
// picks (EventResultsAdmin), et l'archive.

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
          <Box mt="md">
            <EventSettingsFields draft={draft} onChange={setDraft} canChangeBatch={false}>
              <Select
                label="Status"
                allowDeselect={false}
                value={status}
                onChange={(v) => v && setStatus(v as EventStatus)}
                data={EVENT_STATUS_OPTIONS}
                renderOption={({ option }) => (
                  <Stack gap={0}>
                    <Text size="sm">{option.label}</Text>
                    <Text size="xs" c="dimmed">
                      {EVENT_STATUS_DESCRIPTION[option.value as EventStatus]}
                    </Text>
                  </Stack>
                )}
              />
            </EventSettingsFields>
          </Box>
          <Stack gap="lg" maw={560} mt="lg">
            <HelpBlock label="Attendance" help="Absent founders are left out of the draw and the event's forms.">
              <RowList>
                <AttendanceLinkRow eventId={event.id} />
              </RowList>
            </HelpBlock>
            <MatchingField />
            <EventFormsField />
          </Stack>
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
 * Le matching de l'evenement (0 ou 1), en une ligne qui ouvre sa fenetre
 * (MatchingDialog) : le tirage (sa page regle la taille, tire, publie), le type,
 * le retrait. Sans matching : « Add a matching », la meme fenetre.
 */
function MatchingField() {
  const { matching, teams, isDrawPublished } = useAdminEvent();
  const [isOpen, setOpen] = useState(false);
  const tool = matching && TEAM_TOOLS[matching.mode];

  return (
    <HelpBlock label="Matching" help={tool ? `${tool.summary}.` : "Draw teams or tables from the guests. The submission and the peer rating need teams."}>
      <RowList>
        {matching && tool ? (
          <ButtonRow onClick={() => setOpen(true)} title={`${tool.title} of ${matching.size.max}`} subtitle={drawStatus(teams.length, isDrawPublished, tool.groupWord)} />
        ) : (
          <ButtonRow onClick={() => setOpen(true)} title="Add a matching" subtitle="Teams to work together, or tables to meet new people" />
        )}
      </RowList>
      <MatchingDialog opened={isOpen} onClose={() => setOpen(false)} />
    </HelpBlock>
  );
}

/** Ou en est le tirage : a faire, en brouillon, publie. */
function drawStatus(count: number, isPublished: boolean, groupWord: string): string {
  if (isPublished) return `${count} ${groupWord}s published`;
  return count ? `Draft draw: ${count} ${groupWord}s, not published` : `${groupWord[0].toUpperCase()}${groupWord.slice(1)}s not drawn yet`;
}

/** `null` : retirer le matching. */
type MatchingChange = { mode: MatchingMode | null };

/**
 * La fenetre du matching : ouvrir le tirage ; choisir ou changer le type (a sa
 * taille par defaut, reglable au tirage) ; le retirer. Jusqu'a la publication :
 * un brouillon de tirage est alors efface, apres confirmation (`replaceMatching`).
 */
function MatchingDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { event, matching, teams, isDrawPublished: isPublished } = useAdminEvent();
  const { isBusy, run } = useAction();
  const [pending, setPending] = useState<MatchingChange | null>(null);
  const tool = matching && TEAM_TOOLS[matching.mode];

  const close = () => {
    setPending(null);
    onClose();
  };
  const apply = async (change: MatchingChange) => {
    const next = change.mode ? defaultMatching(change.mode) : null;
    const message = !next ? "Matching removed" : matching ? "Matching changed" : "Matching added";
    if (await run(() => replaceMatching(event, next, teams).then(() => true), message)) close();
  };
  // Un brouillon de tirage serait efface : on confirme d'abord.
  const ask = (change: MatchingChange) => (teams.length > 0 ? setPending(change) : void apply(change));

  if (pending) {
    const what = pending.mode ? `Switch to ${TEAM_TOOLS[pending.mode].title.toLowerCase()}` : "Remove the matching";
    return (
      <ResponsiveDialog opened={opened} onClose={close} title={`${what}?`}>
        <Stack>
          <Text size="sm">
            The draft draw ({teams.length} {tool!.groupWord}s) is deleted: you will draw again.
          </Text>
          <Button size="md" color="red" fullWidth loading={isBusy} onClick={() => void apply(pending)}>
            {what}
          </Button>
          <Button variant="subtle" color="gray" disabled={isBusy} onClick={() => setPending(null)}>
            Cancel
          </Button>
        </Stack>
      </ResponsiveDialog>
    );
  }

  return (
    <ResponsiveDialog opened={opened} onClose={close} title={tool ? `${tool.title} of ${matching.size.max}` : "Add a matching"}>
      <Stack>
        {tool && (
          <RowList>
            <LinkRow
              href={paths.adminEventMatching(event.id)}
              title={isPublished ? `See the ${tool.groupWord}s` : "Open the draw"}
              subtitle={drawStatus(teams.length, isPublished, tool.groupWord) + (isPublished ? "" : " · size, rules, publish")}
            />
          </RowList>
        )}
        {isPublished ? (
          <Text size="sm" c="dimmed">
            The {tool?.groupWord}s are published: the matching can no longer be changed or removed.
          </Text>
        ) : (
          <>
            <Text size="sm" fw={500}>
              {matching ? "Type" : "Choose a type"}
            </Text>
            <RowList>
              {MATCHING_MODES.map((m) => (
                <ButtonRow
                  key={m}
                  disabled={isBusy || m === matching?.mode}
                  onClick={() => ask({ mode: m })}
                  title={TEAM_TOOLS[m].title}
                  subtitle={`${TEAM_TOOLS[m].summary}. ${TEAM_TOOLS[m].groupLabel}s of ${GENERATOR_PRESETS[m].defaultSize} by default.`}
                  meta={m === matching?.mode ? <Text size="sm" c="pioneers">Current</Text> : undefined}
                />
              ))}
            </RowList>
            {matching && (
              <Button variant="subtle" color="red" disabled={isBusy} onClick={() => ask({ mode: null })}>
                Remove the matching
              </Button>
            )}
          </>
        )}
      </Stack>
    </ResponsiveDialog>
  );
}
