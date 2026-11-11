import { LeaderboardsProvider } from "@/context/LeaderboardsContext";

export default function LeaderboardLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]/leaderboard">) {
  return <LeaderboardsProvider>{children}</LeaderboardsProvider>;
}
