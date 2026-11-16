"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Button, Checkbox, Group, Menu, Select, Stack, Text } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import { CALENDAR_BATCH_MESSAGE, calendarIdOf } from "@shared/calendarSync";
import { formsClosedByArchive, formsReopenedByRestore, planEventMove, type EventTimes, type FormKept } from "@shared/eventForms";
import { defaultMatching, newEvent, type EventData } from "@shared/events";
import { EVENT_TEMPLATES, eventTemplateOf, templatesOfKind, type EventTemplateKey } from "@shared/presets/eventTemplates";
import { FORM_TEMPLATES } from "@shared/presets/formTemplates";
import { GENERATOR_PRESETS } from "@shared/teamGenerator";
import { EVENT_KINDS, MATCHING_MODES, type EventMatching, type EventStatus, type Form, type MatchingMode, type PioneersEvent, type WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { useAction } from "@/hooks/useAction";
import {
  applyEventTemplate,
  createEventPack,
  saveEventMove,
  setEventArchived,
  templatePlan,
  updateEvent,
  type EventMove,
} from "@/lib/eventsAdmin";
import { replaceMatching } from "@/lib/teamsAdmin";
import { formatDateTime, fromLocalInput, joinList } from "@/lib/format";
import { paths } from "@/lib/paths";
import { ActionBar } from "@/components/admin/ActionBar";
import { ArchiveDialog } from "@/components/admin/ArchiveDialog";
import { AttendanceLinkRow } from "@/components/admin/AttendanceSheet";
import { EventFormsField, EventResultsAdmin } from "@/components/admin/EventResultsAdmin";
import { EventSettingsFields, settingsDraftOf, settingsOf, settingsProblems, type SettingsDraft } from "@/components/admin/EventSettingsFields";
import { TEAM_TOOLS } from "@/components/admin/teamModes";
import { EVENT_KIND_LABEL, EVENT_STATUS_DESCRIPTION, EVENT_STATUS_OPTIONS, archiveWords, defaultEventStart, eventLabel } from "@/components/event/eventLabels";
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
//
// Agenda Google (SPECS §2, 16/11) : un batch relie ne cree pas d'evenement ici
// (« New » renvoie a l'agenda). Un evenement venu de l'agenda a ses champs
// d'agenda (CALENDAR_FIELDS) grises ; on lui applique un template
// (TemplateField) ; l'archiver le masque, la synchro le laisse masque.

// ---- Creer ------------------------------------------------------------------------

/** Un matching en clair : « teams of 3 ». */
const matchingLine = (m: EventMatching | null | undefined) => (m ? `${TEAM_TOOLS[m.mode].title.toLowerCase()} of ${m.size.max}` : null);

/** Ce que cree un pack, en clair : son matching et ses formulaires. */
function packLine(key: EventTemplateKey): string {
  const t = EVENT_TEMPLATES[key];
  const forms = t.forms.map((f) => FORM_TEMPLATES[f].label.toLowerCase());
  return [matchingLine(t.matching), ...forms].filter(Boolean).join(", ") || t.summary;
}

/** Un evenement neuf du batch de travail, construit en memoire, ecrit a la creation. */
export function NewEventEditor() {
  const initial = useSearchParams().get("template");
  const preset = initial && initial in EVENT_TEMPLATES ? (initial as EventTemplateKey) : null;
  // `undefined` : pas encore choisi ; `null` : a blanc.
  const [templateKey, setTemplateKey] = useState<EventTemplateKey | null | undefined>(preset ?? undefined);
  const { batch } = useAdmin();
  const back = { href: paths.adminEvents(), label: "Events" };

  if (calendarIdOf(batch)) {
    return (
      <>
        <PageHeader back={back} title="New event" subtitle={`In ${batch.name}.`} />
        <Section title="From Google Calendar">
          <Text size="sm">
            {CALENDAR_BATCH_MESSAGE} Then open it here to pick a template (matching and forms).
          </Text>
        </Section>
      </>
    );
  }
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
        // Un nom a donner, comme a blanc : le libelle du modele n'est pas un nom d'evenement.
        name: "",
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
  const { events, forms: batchForms } = useAdmin();
  const { forms } = useAdminEvent();
  const { isBusy, run } = useAction();
  const [initial] = useState(() => settingsDraftOf(event));
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<EventStatus>(event.status);
  const [confirmArchive, setConfirmArchive] = useState(false);
  /** Le nouvel horaire, en attente de la fenetre « Move its forms too? ». */
  const [move, setMove] = useState<EventTimes | null>(null);
  const isArchived = event.archivedDateISOString !== null;
  const isDirty = status !== event.status || JSON.stringify(draft) !== JSON.stringify(initial);
  const problems = settingsProblems(draft);
  const label = eventLabel(event);
  const toClose = formsClosedByArchive(forms);
  const toReopen = formsReopenedByRestore(event, forms);
  // Venu de l'agenda : l'archiver, c'est le masquer.
  const archiveWord = archiveWords(event);

  const settings = () => ({ ...settingsOf(draft), status });
  const save = () => {
    const { startDateISOString, endDateISOString } = settings();
    const next = { startDateISOString, endDateISOString };
    const isMoved = startDateISOString !== event.startDateISOString || endDateISOString !== event.endDateISOString;
    // Un nouvel horaire : la fenetre dit ce qu'il deplace, s'il deplace quelque chose.
    const plan = isMoved ? planEventMove({ event, next, events, forms: batchForms, moveLinked: true, nowISO: new Date().toISOString() }) : null;
    if (plan && (plan.moves.length > 0 || plan.kept.length > 0 || plan.linked)) setMove(next);
    else void run(() => updateEvent(event, settings()), "Event saved");
  };
  /** `null` : l'evenement seul, les formulaires gardent leurs dates. */
  const saveMove = (plan: EventMove | null) => {
    setMove(null);
    const n = plan?.moves.length ?? 0;
    void run(() => (plan ? saveEventMove(event, settings(), plan) : updateEvent(event, settings())), n ? `Event saved, ${formsCount(n)} moved` : "Event saved");
  };
  const archive = async () => {
    setConfirmArchive(false);
    if (await run(() => setEventArchived(event, true, forms).then(() => true), "Event archived")) router.push(paths.adminEvents());
  };

  return (
    <>
      <PageHeader
        back={{ href: paths.adminEvents(), label: "Events" }}
        title={event.name}
        subtitle={[label, formatDateTime(event.startDateISOString), isArchived ? archiveWord.state : null].filter(Boolean).join(" · ")}
      />

      {isArchived ? (
        <Section
          title={archiveWord.state}
          hint={`Hidden from founders, the calendar and the staff tools.${archiveWord.note ? ` ${archiveWord.note}` : ""} Its teams, results and scores are kept.${
            toReopen.length ? ` Restoring it opens again the forms the archive closed: ${titles(toReopen)}.` : ""
          }`}
        >
          <Button size="md" fullWidth maw={480} loading={isBusy} onClick={() => void run(() => setEventArchived(event, false, forms), "Event restored")}>
            Restore this event
          </Button>
        </Section>
      ) : (
        <>
          <Box mt="md">
            <EventSettingsFields draft={draft} onChange={setDraft} canChangeBatch={false} calendarSource={event.calendarSource}>
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
            <TemplateField />
            <MatchingField />
            <EventFormsField />
          </Stack>
          <EventResultsAdmin />
          <Section title="Archive">
            <RowList>
              <ButtonRow
                onClick={() => setConfirmArchive(true)}
                title={archiveWord.action}
                subtitle={`Hides it from founders, the calendar and the staff tools.${archiveWord.note ? ` ${archiveWord.note}` : ""}`}
              />
            </RowList>
          </Section>
          <ActionBar label={isDirty ? "Save" : "No changes"} loading={isBusy} disabled={!isDirty || problems.length > 0} problem={isDirty ? problems[0] : null} onClick={save} />
        </>
      )}

      <ArchiveDialog what="event" opened={confirmArchive} onClose={() => setConfirmArchive(false)} onArchive={() => void archive()}>
        It leaves the lists, the founders&apos; pages and the calendar.
        {toClose.length > 0 && ` Its open forms close, and leave the founders' To do: ${titles(toClose)}.`} Its teams, results and scores are
        kept, and you can restore it{toClose.length > 0 && ": these forms then open again"}.
      </ArchiveDialog>

      {move && <MoveDialog event={event} next={move} isBusy={isBusy} onCancel={() => setMove(null)} onSave={saveMove} />}
    </>
  );
}

const titles = (forms: readonly WithId<Form>[]) => joinList(forms.map((f) => f.title));
const formsCount = (n: number) => `${n} ${n === 1 ? "form" : "forms"}`;

/** « Opens Thu 19 Nov, 15:00 · due Thu 19 Nov, 16:55 ». */
const formDatesLine = (opens: string | null, deadline: string | null) =>
  [opens ? `Opens ${formatDateTime(opens)}` : "No opening date", deadline ? `due ${formatDateTime(deadline)}` : "no deadline"].join(" · ");

/** Pourquoi un formulaire garde ses dates. */
const keptLine = ({ reason, tiedTo }: FormKept<unknown>) =>
  reason === "tied" ? `stays with ${tiedTo}, it opens at its start` : reason === "closed" ? "closed, keeps its dates" : "past its deadline, keeps its dates";

/**
 * Le nouvel horaire deplace les formulaires (planEventMove, shared/eventForms.ts) :
 * la fenetre liste ce qui bouge et ce qui garde ses dates, et propose de decaler
 * le creneau Debrief accole. « Save, keep the forms' dates » n'enregistre que l'evenement.
 */
function MoveDialog({
  event,
  next,
  isBusy,
  onCancel,
  onSave,
}: {
  event: WithId<PioneersEvent>;
  next: EventTimes;
  isBusy: boolean;
  onCancel: () => void;
  onSave: (plan: EventMove | null) => void;
}) {
  const { events, eventsById, forms } = useAdmin();
  const [moveLinked, setMoveLinked] = useState(true);
  const plan = useMemo(() => planEventMove({ event, next, events, forms, moveLinked, nowISO: new Date().toISOString() }), [event, next, events, forms, moveLinked]);
  const n = plan.moves.length;
  const otherEvent = (f: WithId<Form>) => (f.eventId && f.eventId !== event.id ? ` · ${eventsById.get(f.eventId)?.name ?? "another event"}` : "");

  return (
    <ResponsiveDialog opened onClose={onCancel} title={n ? "Move its forms too?" : "Save the new time?"}>
      <Stack>
        <Text size="sm">
          The event now starts {formatDateTime(next.startDateISOString)}
          {next.endDateISOString ? ` and ends ${formatDateTime(next.endDateISOString)}` : ""}. Its forms keep their place in it: at the start, 15 min
          before the end, or 24 h after opening. Dates set by hand keep their distance to the start or the end. Closed forms, and forms past their
          deadline, keep their dates.
        </Text>
        {plan.linked && (
          <Checkbox
            size="md"
            checked={moveLinked}
            onChange={(e) => setMoveLinked(e.currentTarget.checked)}
            label={`Also move ${plan.linked.event.name} to ${formatDateTime(plan.linked.to.startDateISOString)}`}
            description="It starts when this event ends, and the peer rating opens at its start."
          />
        )}
        {plan.moves.map(({ form, opensDateISOString, deadlineDateISOString }) => (
          <div key={form.id}>
            <Text size="sm" fw={500}>
              {form.title}
              {otherEvent(form)}
            </Text>
            <Text size="sm">{formDatesLine(opensDateISOString, deadlineDateISOString)}</Text>
            <Text size="xs" c="dimmed">
              Was: {formDatesLine(form.opensDateISOString, form.deadlineDateISOString)}
            </Text>
          </div>
        ))}
        {plan.kept.map((k) => (
          <Text key={k.form.id} size="sm" c="dimmed">
            {k.form.title}
            {otherEvent(k.form)}: {keptLine(k)}.
          </Text>
        ))}
        <Button size="md" fullWidth loading={isBusy} onClick={() => onSave(plan)}>
          {n ? `Save and move ${formsCount(n)}` : "Save"}
        </Button>
        {(n > 0 || plan.linked?.isMoved) && (
          <Button variant="subtle" color="gray" disabled={isBusy} onClick={() => onSave(null)}>
            Save, keep the forms&apos; dates
          </Button>
        )}
        <Button variant="subtle" color="gray" disabled={isBusy} onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </ResponsiveDialog>
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

const TEMPLATE_OPTIONS = EVENT_KINDS.map((kind) => ({
  group: EVENT_KIND_LABEL[kind],
  items: templatesOfKind(kind).map((k) => ({ value: k, label: EVENT_TEMPLATES[k].label })),
}));

/**
 * Le template de l'evenement : un evenement venu de l'agenda arrive sans. En
 * appliquer un donne son etiquette, son matching (s'il n'en a pas) et les
 * formulaires du pack qu'il n'a pas encore (templatePlan, lib/eventsAdmin.ts).
 */
function TemplateField() {
  const { event, forms, teams } = useAdminEvent();
  const { isBusy, run } = useAction();
  const [chosen, setChosen] = useState<EventTemplateKey | null>(null);
  const current = eventTemplateOf(event.templateKey);
  const hasTeams = teams.length > 0;
  const plan = useMemo(() => (chosen ? templatePlan(event, chosen, forms, hasTeams) : null), [chosen, event, forms, hasTeams]);

  const apply = async () => {
    if (!chosen || !plan) return;
    const applied = await run(() => applyEventTemplate(event.id, plan).then(() => true), `${EVENT_TEMPLATES[chosen].label} applied`);
    if (applied) setChosen(null);
  };

  return (
    <HelpBlock label="Template" help="A pack: the label, a matching and the forms. Applying one adds what the event does not have yet.">
      <Select
        placeholder="Pick a template"
        data={TEMPLATE_OPTIONS}
        value={chosen ?? (current ? event.templateKey : null)}
        onChange={(v) => setChosen(v && v !== event.templateKey ? (v as EventTemplateKey) : null)}
        searchable
        comboboxProps={{ withinPortal: true }}
      />
      {chosen && plan && (
        <Stack gap={6} mt="xs">
          <Text size="sm" c="dimmed">
            {[
              `Label: ${EVENT_KIND_LABEL[EVENT_TEMPLATES[chosen].kind].toLowerCase()}`,
              matchingLine(plan.patch.matching),
              plan.forms.length ? `adds ${joinList(plan.forms.map((p) => p.form.title))}` : "no new form",
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Group gap="xs">
            <Button size="sm" loading={isBusy} onClick={() => void apply()}>
              Apply
            </Button>
            <Button size="sm" variant="subtle" color="gray" onClick={() => setChosen(null)}>
              Cancel
            </Button>
          </Group>
        </Stack>
      )}
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
              title={isPublished ? `Open the ${tool.groupWord}s` : "Open the draw"}
              subtitle={drawStatus(teams.length, isPublished, tool.groupWord) + (isPublished ? " · swap, move, change a leader" : " · size, rules, publish")}
            />
          </RowList>
        )}
        {isPublished ? (
          <Text size="sm" c="dimmed">
            The {tool?.groupWord}s are published: open them above to swap or move a founder, or change a leader. The type of matching can no
            longer be changed, nor the matching removed.
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
