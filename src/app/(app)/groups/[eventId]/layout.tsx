import { PublicTeamsProvider } from "@/context/PublicTeamsContext";
import { shareMetadata } from "@/lib/shareBanner";

// Les groupes publies du matching d'un evenement, lien partage sans compte
// (`paths.groups` : la meme page sous trois routes, une banniere par route).

export const metadata = shareMetadata("groups", "Groups", "Find your team or your table.", "Find your group");

export default function PublicGroupsLayout({ children }: LayoutProps<"/groups/[eventId]">) {
  return <PublicTeamsProvider>{children}</PublicTeamsProvider>;
}
