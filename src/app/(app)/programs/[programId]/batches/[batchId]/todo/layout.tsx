import { MeGate } from "@/components/founder/MeGate";
import { OpenFormsProvider } from "@/context/OpenFormsContext";

export default function TodoLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]/todo">) {
  return (
    <MeGate>
      <OpenFormsProvider>{children}</OpenFormsProvider>
    </MeGate>
  );
}
