import { FounderProvider } from "@/context/FounderContext";
import { SelfProviders } from "@/components/founder/SelfProviders";

// La fiche d'un fondateur ; sur SA propre fiche, le fondateur a aussi ce qui
// lui reste a faire (SelfProviders). « Me » mene ici.
export default function FounderLayout({
  children,
}: LayoutProps<"/programs/[programId]/batches/[batchId]/founders/[founderId]">) {
  return (
    <FounderProvider>
      <SelfProviders>{children}</SelfProviders>
    </FounderProvider>
  );
}
