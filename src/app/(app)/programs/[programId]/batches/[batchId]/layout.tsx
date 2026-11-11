import { BatchProvider } from "@/context/BatchContext";
import { CohortProvider } from "@/context/CohortContext";
import { EventsProvider } from "@/context/EventsContext";
import { FoundersProvider } from "@/context/FoundersContext";
import { LeaderboardsProvider } from "@/context/LeaderboardsContext";
import { ListsProvider } from "@/context/ListsContext";
import { StartupsProvider } from "@/context/StartupsContext";
import { BatchShell } from "./_chrome/BatchShell";

// Les listes du batch sont montees ICI, au plus haut niveau qui les consomme :
// la fiche d'une startup affiche ses membres, celle d'un fondateur sa startup,
// ses equipes et leurs classements, l'accueil les evenements et la cohorte. Montees sous /founders et
// /startups, chaque passage de l'un a l'autre desabonnerait puis relirait tout
// (lecon Trippple : garder l'abonnement EST le cache).
export default function BatchLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]">) {
  return (
    <BatchProvider>
      <FoundersProvider>
        <StartupsProvider>
          <EventsProvider>
            <ListsProvider>
              <CohortProvider>
                <LeaderboardsProvider>
                  <BatchShell>{children}</BatchShell>
                </LeaderboardsProvider>
              </CohortProvider>
            </ListsProvider>
          </EventsProvider>
        </StartupsProvider>
      </FoundersProvider>
    </BatchProvider>
  );
}
