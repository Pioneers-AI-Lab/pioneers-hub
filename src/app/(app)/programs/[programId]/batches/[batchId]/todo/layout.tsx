import { MeGate } from "@/components/founder/MeGate";
import { ChallengeTasksProvider } from "@/context/ChallengeTasksContext";
import { MyPicksProvider } from "@/context/MyPicksContext";
import { OpenFormsProvider } from "@/context/OpenFormsContext";

export default function TodoLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]/todo">) {
  return (
    <MeGate>
      <OpenFormsProvider>
        <MyPicksProvider>
          <ChallengeTasksProvider>{children}</ChallengeTasksProvider>
        </MyPicksProvider>
      </OpenFormsProvider>
    </MeGate>
  );
}
