import { EventResultsAdmin } from "@/components/admin/EventResultsAdmin";
import { TeamGenerator } from "@/components/admin/TeamGenerator";

export default function ChallengeTeamsEventPage() {
  return (
    <>
      <TeamGenerator mode="challenge" />
      <EventResultsAdmin />
    </>
  );
}
