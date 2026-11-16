import { PublicTeamsProvider } from "@/context/PublicTeamsContext";
import { shareMetadata } from "@/lib/shareBanner";

// Ancien lien de la lunch roulette (deja partage) : meme page que `/groups/{id}`.

export const metadata = shareMetadata("Lunch roulette", "Find your lunch table.");

export default function PublicLunchRouletteLayout({ children }: LayoutProps<"/lunch-roulette/[eventId]">) {
  return <PublicTeamsProvider>{children}</PublicTeamsProvider>;
}
