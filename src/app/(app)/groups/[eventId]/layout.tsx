import { PublicTeamsProvider } from "@/context/PublicTeamsContext";
import { shareMetadata } from "@/lib/shareBanner";

// Les groupes publies du matching d'un evenement (equipes ou tables), lien
// partage sans compte. `/lunch-roulette/{id}` et `/challenge-teams/{id}` (liens
// deja partages) montrent la meme page. Apercu du lien : la banniere de la
// lunch roulette (lib/shareBanner.ts), le serveur ne sachant pas le type de
// l'evenement.

export const metadata = shareMetadata("Groups", "Find your team or your table.", "Find your group");

export default function PublicGroupsLayout({ children }: LayoutProps<"/groups/[eventId]">) {
  return <PublicTeamsProvider>{children}</PublicTeamsProvider>;
}
