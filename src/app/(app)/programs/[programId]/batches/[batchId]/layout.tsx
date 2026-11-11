import { BatchProvider } from "@/context/BatchContext";
import { EventsProvider } from "@/context/EventsContext";
import { FoundersProvider } from "@/context/FoundersContext";
import { ListsProvider } from "@/context/ListsContext";
import { StartupsProvider } from "@/context/StartupsContext";
import { BatchShell } from "./_chrome/BatchShell";

// Les listes du batch sont montees ICI, au plus haut niveau qui les consomme :
// la fiche d'une startup affiche ses membres, celle d'un fondateur sa startup
// et ses equipes, l'accueil les evenements a venir. Montees sous /founders et
// /startups, chaque passage de l'un a l'autre desabonnerait puis relirait tout
// (lecon Trippple : garder l'abonnement EST le cache).
export default function BatchLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]">) {
  return (
    <BatchProvider>
      <FoundersProvider>
        <StartupsProvider>
          <EventsProvider>
            <ListsProvider>
              <BatchShell>{children}</BatchShell>
            </ListsProvider>
          </EventsProvider>
        </StartupsProvider>
      </FoundersProvider>
    </BatchProvider>
  );
}
