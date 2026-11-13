import type { ReactNode } from "react";
import { MeGate } from "@/components/founder/MeGate";
import { FormsToFillProvider } from "@/context/FormsToFillContext";

// « Me » et « To do » (groupe sans segment d'URL) : un seul montage du fondateur
// connecte et de ce qui lui reste a faire (`useTodoItems` : des formulaires),
// garde d'un onglet a l'autre.
export default function MineLayout({ children }: { children: ReactNode }) {
  return (
    <MeGate>
      <FormsToFillProvider>{children}</FormsToFillProvider>
    </MeGate>
  );
}
