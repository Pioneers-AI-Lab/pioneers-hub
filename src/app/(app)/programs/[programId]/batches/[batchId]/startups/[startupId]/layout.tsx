import { StartupProvider } from "@/context/StartupContext";

export default function StartupLayout({
  children,
}: LayoutProps<"/programs/[programId]/batches/[batchId]/startups/[startupId]">) {
  return <StartupProvider>{children}</StartupProvider>;
}
