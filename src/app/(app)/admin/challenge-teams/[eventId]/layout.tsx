import { AdminEventProvider } from "@/context/AdminEventContext";
import { paths } from "@/lib/paths";

export default function ChallengeTeamsEventLayout({ children }: LayoutProps<"/admin/challenge-teams/[eventId]">) {
  return (
    <AdminEventProvider kind="team_challenge" backHref={paths.adminChallengeTeams()}>
      {children}
    </AdminEventProvider>
  );
}
