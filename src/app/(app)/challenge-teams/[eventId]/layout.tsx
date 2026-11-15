import type { Metadata } from "next";
import { APP_NAME } from "@shared/brand";
import { PublicTeamsProvider } from "@/context/PublicTeamsContext";

// Equipes publiees d'un challenge, lien partage (sans compte). Comme la lunch
// roulette, le serveur Next ne lit aucune donnee : l'apercu du lien ne porte
// pas le nom de l'evenement.

export const metadata: Metadata = {
  title: "Challenge teams",
  description: "Find your team.",
  openGraph: { title: "Challenge teams", description: "Find your team.", siteName: APP_NAME, type: "website" },
};

export default function PublicChallengeTeamsLayout({ children }: LayoutProps<"/challenge-teams/[eventId]">) {
  return <PublicTeamsProvider>{children}</PublicTeamsProvider>;
}
