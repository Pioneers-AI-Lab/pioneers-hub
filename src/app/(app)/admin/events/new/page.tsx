"use client";

import { NewEventEditor } from "@/components/admin/EventEditor";

// Admin > Events > New : « Blank » ou un template (un pack), puis les reglages.
// `?template=lunch_roulette` : le pack choisi d'avance.
export default function NewEventPage() {
  return <NewEventEditor />;
}
