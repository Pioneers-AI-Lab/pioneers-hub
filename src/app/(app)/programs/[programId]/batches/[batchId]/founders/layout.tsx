import { FounderDirectoriesProvider } from "@/context/FounderDirectoriesContext";

export default function FoundersLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]/founders">) {
  return <FounderDirectoriesProvider>{children}</FounderDirectoriesProvider>;
}
