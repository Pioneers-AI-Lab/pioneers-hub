import { FounderProvider } from "@/context/FounderContext";
import { SelfProviders } from "@/components/founder/SelfProviders";
import { ProfileSkeleton } from "@/components/ui/Skeleton";

// La fiche d'un fondateur ; sur SA propre fiche, le fondateur a aussi ce qui
// lui reste a faire (SelfProviders). « Me » mene ici. Sans la fiche en memoire
// (lien direct a froid), son squelette.
export default function FounderLayout({
  children,
}: LayoutProps<"/programs/[programId]/batches/[batchId]/founders/[founderId]">) {
  return (
    <FounderProvider loader={<ProfileSkeleton />}>
      <SelfProviders>{children}</SelfProviders>
    </FounderProvider>
  );
}
