import { FounderProvider } from "@/context/FounderContext";

export default function FounderLayout({
  children,
}: LayoutProps<"/programs/[programId]/batches/[batchId]/founders/[founderId]">) {
  return <FounderProvider>{children}</FounderProvider>;
}
