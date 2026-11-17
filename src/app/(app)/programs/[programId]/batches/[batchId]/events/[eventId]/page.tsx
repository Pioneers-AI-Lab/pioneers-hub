"use client";

import { Text } from "@mantine/core";
import { tracksAttendance } from "@shared/attendance";
import { formConcernsFounder } from "@shared/formRules";
import { formState } from "@shared/forms";
import { leaderIdOf } from "@shared/teamGenerator";
import type { Form, WithId } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useEventPage } from "@/context/EventPageContext";
import { useFounders } from "@/context/FoundersContext";
import { useLeaderboards } from "@/context/LeaderboardsContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { formatDateTime, formatDateTimeRange } from "@/lib/format";
import { paths } from "@/lib/paths";
import { shownEventLabel } from "@/components/event/eventLabels";
import { TEAM_LABELS } from "@/components/event/teamLabels";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExternalLinkRow, LinkRow, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";

// ----------------------------
// Un evenement, pour tous les roles du batch (decision du 13/11)
// ----------------------------
// Ouverte depuis l'accueil, To do, Me, une fiche ou le leaderboard : ce qu'est
// l'evenement, puis ce qui lui est attache : mon groupe et la page publique du
// matching (et qui le mene), ses formulaires (a faire, fait, ferme), son
// leaderboard. Un fondateur marque absent ne s'y voit proposer aucun formulaire
// (comme dans To do) et le lit. Le staff y
// voit aussi les brouillons et le jury, et le lien vers l'administration.

export default function EventPage() {
  const { program } = useProgram();
  const { batch, role, viewerFounderId } = useBatch();
  const { event, matching, forms, groups, doneFormIds, myAttendance } = useEventPage();
  const { foundersById } = useFounders();
  const { startupsById } = useStartups();
  const { leaderboardsByEventId } = useLeaderboards();
  const isStaff = role === "staff";
  const nowISO = new Date().toISOString();

  const tool = matching ? TEAM_LABELS[matching.mode] : null;
  const mine = viewerFounderId ? (groups.find((g) => g.memberIds.includes(viewerFounderId)) ?? null) : null;
  const leaderId = mine && leaderIdOf(mine);
  const isAbsent = myAttendance?.status === "absent" && tracksAttendance(event);
  const board = leaderboardsByEventId.get(event.id);
  // Un fondateur voit les formulaires publies qui le concernent (comme To do : ni absent, ni jury) ; le staff voit tout et ouvre l'editeur.
  const founder = viewerFounderId ? foundersById.get(viewerFounderId) : undefined;
  const shown = forms.filter((f) => isStaff || (f.version > 0 && !!founder && formConcernsFounder(f, founder, event, mine !== null, myAttendance)));
  const guests =
    event.audience === "batch"
      ? `All founders of ${batch.name}`
      : [...event.guests.map((g) => g.name), ...event.startupIds.map((id) => startupsById.get(id)?.name ?? id)].join(", ");

  return (
    <>
      {/* Retour : la page que porte l'onglet actif (Calendar), sous son nom (docs/UI-RULES.md).
          Le type, seulement s'il apprend quelque chose (`shownEventLabel`). */}
      <PageHeader
        back={{ href: paths.calendar(program.id, batch.id), label: "Calendar" }}
        title={event.name}
        subtitle={[shownEventLabel(event), event.status === "draft" ? "Draft" : null].filter(Boolean).join(" · ")}
      />

      <Section title="When and where">
        <Field label="When">{formatDateTimeRange(event.startDateISOString, event.endDateISOString)}</Field>
        <Field label="Where">{event.location}</Field>
        <Field label="Guests">{guests}</Field>
        <Field label="About">{event.topic}</Field>
      </Section>

      {(event.videoCallUrl || event.signUpUrl || event.resourceUrl) && (
        <Section title="Links">
          <RowList>
            {event.videoCallUrl && <ExternalLinkRow href={event.videoCallUrl} title="Join the video call" subtitle={event.videoCallUrl} />}
            {event.signUpUrl && <ExternalLinkRow href={event.signUpUrl} title="Sign up" subtitle={event.signUpUrl} />}
            {event.resourceUrl && <ExternalLinkRow href={event.resourceUrl} title="Resources" subtitle={event.resourceUrl} />}
          </RowList>
        </Section>
      )}

      {isAbsent && (
        <Section title="Attendance">
          <Text size="sm">
            You were marked absent at this event, so its forms are not for you{tool && !mine ? `, and you are not in a ${tool.groupWord}` : ""}. A
            mistake? Tell the Pioneers team.
          </Text>
        </Section>
      )}

      {matching && tool && (
        <Section title={mine ? `Your ${tool.groupWord} · ${mine.name}` : `${tool.groupLabel}s`}>
          {mine && leaderId && (
            <Text size="sm">
              {leaderId === viewerFounderId
                ? `You are the ${tool.groupWord} lead: ${tool.leaderDuty}.`
                : `${tool.groupLabel} lead: ${foundersById.get(leaderId)?.name ?? "a teammate"}.`}
            </Text>
          )}
          {groups.length === 0 ? (
            <Text size="sm" c="dimmed">
              The {tool.groupWord}s are not out yet.
            </Text>
          ) : (
            <RowList>
              {mine &&
                mine.memberIds
                  .filter((id) => id !== viewerFounderId)
                  .map((id) => {
                    const f = foundersById.get(id);
                    return (
                      <LinkRow
                        key={id}
                        href={paths.founder(program.id, batch.id, id)}
                        title={f?.name ?? "Founder"}
                        avatar={{ name: f?.name ?? "Founder", photoUrl: f?.photoUrl }}
                        meta={id === leaderId ? <Text size="sm" c="dimmed">Leader</Text> : undefined}
                      />
                    );
                  })}
              <LinkRow href={paths.groups(event.id, matching.mode)} title={`All ${tool.groupWord}s`} subtitle={`${groups.length} ${tool.groupWord}s, the public page`} />
            </RowList>
          )}
        </Section>
      )}

      {shown.length > 0 && (
        <Section title="Forms">
          <RowList>
            {shown.map((f) => (
              <FormLine key={f.id} form={f} isStaff={isStaff} isDone={doneFormIds.has(f.id)} nowISO={nowISO} />
            ))}
          </RowList>
        </Section>
      )}

      {board && board.rows.length > 0 && (
        <Section title="Leaderboard">
          <RowList>
            <LinkRow
              href={paths.leaderboard(program.id, batch.id, event.id)}
              title={board.rows[0] ? `#1 ${board.rows[0].name}` : "Ranking"}
              subtitle={`${board.rows.length} ranked${board.metric ? ` by ${board.metric.label.toLowerCase()}` : " by the jury"}`}
            />
          </RowList>
        </Section>
      )}

      {isStaff && (
        <Section title="Staff">
          <RowList>
            <LinkRow href={paths.adminEvent(event.id)} title="Manage this event" subtitle="Settings, matching, forms, jury, attendance" />
          </RowList>
        </Section>
      )}
    </>
  );
}

/** Un formulaire de l'evenement : son etat pour moi (a faire, fait, ferme), ou pour le staff. */
function FormLine({ form, isStaff, isDone, nowISO }: { form: WithId<Form>; isStaff: boolean; isDone: boolean; nowISO: string }) {
  const state = formState(form, nowISO);
  const meta =
    state === "draft"
      ? "Draft"
      : state === "not_open_yet"
        ? `Opens ${formatDateTime(form.opensDateISOString)}`
        : state === "closed"
          ? "Closed"
          : isDone
            ? "Done"
            : isStaff
              ? "Open"
              : "To do";
  const href = isStaff ? paths.adminForm(form.id) : paths.form(form.id);
  return (
    <LinkRow
      href={href}
      title={form.title}
      subtitle={form.description ?? undefined}
      meta={
        <Text size="sm" c={meta === "To do" ? "pioneers" : "dimmed"}>
          {meta}
        </Text>
      }
    />
  );
}
