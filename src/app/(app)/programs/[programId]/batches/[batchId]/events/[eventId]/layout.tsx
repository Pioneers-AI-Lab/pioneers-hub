import { EventPageProvider } from "@/context/EventPageContext";

// La page d'un evenement, pour tous les roles du batch : l'evenement et ce qui lui est attache.
export default function EventLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]/events/[eventId]">) {
  return <EventPageProvider>{children}</EventPageProvider>;
}
