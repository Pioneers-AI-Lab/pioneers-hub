import type { Metadata } from "next";
import { APP_NAME } from "@shared/brand";
import { PublicTeamsProvider } from "@/context/PublicTeamsContext";

// Les groupes publies du matching d'un evenement (equipes ou tables), lien
// partage sans compte. Le serveur Next ne lit aucune donnee : l'apercu du lien
// ne porte pas le nom de l'evenement. `/lunch-roulette/{id}` et
// `/challenge-teams/{id}` (liens deja partages) montrent la meme page.

export const metadata: Metadata = {
  title: "Groups",
  description: "Find your team or your table.",
  openGraph: { title: "Find your group", description: "Find your team or your table.", siteName: APP_NAME, type: "website" },
};

export default function PublicGroupsLayout({ children }: LayoutProps<"/groups/[eventId]">) {
  return <PublicTeamsProvider>{children}</PublicTeamsProvider>;
}
