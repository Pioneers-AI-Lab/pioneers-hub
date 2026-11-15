import type { ReactNode } from "react";
import { MeGate } from "@/components/founder/MeGate";
import { TodoProviders } from "@/components/todo/TodoProviders";

// « Me » et « To do » (groupe sans segment d'URL) : un seul montage du fondateur
// connecte et de ce qui lui reste a faire (`useTodoItems` : des formulaires et
// la checklist du batch, `TodoProviders`), garde d'un onglet a l'autre.
export default function MineLayout({ children }: { children: ReactNode }) {
  return (
    <MeGate>
      <TodoProviders>{children}</TodoProviders>
    </MeGate>
  );
}
