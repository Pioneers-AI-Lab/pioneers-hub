"use client";

import type { ReactNode } from "react";
import { useFounder } from "@/context/FounderContext";
import { TodoProviders } from "@/components/todo/TodoProviders";

/**
 * Ce que lit « ce qui me reste a faire » (`useTodoItems`) : monte seulement sur
 * SA propre fiche (/founders/{son id}), pas sur celle d'un autre fondateur.
 * Meme pile que (mine)/layout.tsx pour « To do ».
 */
export function SelfProviders({ children }: { children: ReactNode }) {
  const { isSelf } = useFounder();
  if (!isSelf) return children;
  return <TodoProviders>{children}</TodoProviders>;
}
