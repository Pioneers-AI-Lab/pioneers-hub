"use client";

import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { useParamsTS } from "@/hooks/useParamsTS";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { StaffTeamResults } from "@/components/admin/StaffTeamResults";
import { PageHeader } from "@/components/ui/PageHeader";
import { Empty } from "@/components/ui/Section";

// Les resultats d'une equipe, vus et corriges par le staff : les champs du
// Debrief des fondateurs ; les valeurs saisies ici sont marquees `staff`.
export default function AdminTeamResultsPage() {
  const { teamId } = useParamsTS<{ teamId: string }>();
  const { event, teams, submissionsByTeamId, metrics } = useAdminEvent();
  const { foundersById } = useAdmin();
  const back = { href: paths.adminEventMatching(event.id), label: event.name };
  const team = teams.find((t) => t.id === teamId && t.publishedDateISOString !== null);

  if (!team) {
    return (
      <>
        <PageHeader back={back} title="Team" />
        <Empty>This team does not exist or is not published yet.</Empty>
      </>
    );
  }
  const submission = submissionsByTeamId.get(team.id) ?? null;
  const isStarted = event.startDateISOString <= new Date().toISOString();

  return (
    <>
      <PageHeader back={back} title={team.name} subtitle={team.memberIds.map((id) => foundersById.get(id)?.name ?? id).join(", ")} />
      {isStarted ? (
        <StaffTeamResults
          key={submission?.submittedDateISOString ?? "new"}
          eventId={event.id}
          teamId={team.id}
          metrics={metrics}
          current={submission}
          hint={[
            submission?.submittedDateISOString ? `Last saved ${formatDateTime(submission.submittedDateISOString)}.` : "Nothing entered yet.",
            "The metrics are the questions of the event's debrief. Numbers you save here are marked as entered by the staff.",
          ].join(" ")}
        />
      ) : (
        <Empty>The event has not started yet. Results open once it does.</Empty>
      )}
    </>
  );
}
