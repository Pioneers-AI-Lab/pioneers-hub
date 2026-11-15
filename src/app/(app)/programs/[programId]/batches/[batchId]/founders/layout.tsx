import { FounderDirectoriesProvider } from "@/context/FounderDirectoriesContext";

// Liste, grille et fiches (dont « Me ») : l'annuaire en grille (ma shortlist / mes rencontres : layout du batch).
export default function FoundersLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]/founders">) {
  return <FounderDirectoriesProvider>{children}</FounderDirectoriesProvider>;
}
