import { PublicTeamsProvider } from "@/context/PublicTeamsContext";
import { shareMetadata } from "@/lib/shareBanner";

// Lien partage des tables (`paths.groups`) : meme page que `/groups/{id}`.

export const metadata = shareMetadata("lunchRoulette", "Lunch roulette", "Find your lunch table.");

export default function PublicLunchRouletteLayout({ children }: LayoutProps<"/lunch-roulette/[eventId]">) {
  return <PublicTeamsProvider>{children}</PublicTeamsProvider>;
}
