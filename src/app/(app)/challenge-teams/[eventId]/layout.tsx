import { PublicTeamsProvider } from "@/context/PublicTeamsContext";
import { shareMetadata } from "@/lib/shareBanner";

// Ancien lien des equipes d'un challenge (deja partage) : meme page que `/groups/{id}`.

export const metadata = shareMetadata("groups", "Challenge teams", "Find your team.");

export default function PublicChallengeTeamsLayout({ children }: LayoutProps<"/challenge-teams/[eventId]">) {
  return <PublicTeamsProvider>{children}</PublicTeamsProvider>;
}
