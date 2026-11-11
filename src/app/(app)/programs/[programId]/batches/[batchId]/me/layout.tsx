import { MeGate } from "@/components/founder/MeGate";

export default function MeLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]/me">) {
  return <MeGate>{children}</MeGate>;
}
