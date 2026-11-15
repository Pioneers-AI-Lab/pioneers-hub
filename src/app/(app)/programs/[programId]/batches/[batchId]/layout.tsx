import { BatchProvider } from "@/context/BatchContext";
import { CohortProvider } from "@/context/CohortContext";
import { EventsProvider } from "@/context/EventsContext";
import { FoundersProvider } from "@/context/FoundersContext";
import { LeaderboardsProvider } from "@/context/LeaderboardsContext";
import { ListsProvider } from "@/context/ListsContext";
import { MyConnectionsProvider } from "@/context/MyConnectionsContext";
import { StartupsProvider } from "@/context/StartupsContext";
import { TasksProvider } from "@/context/TasksContext";
import { BatchShell } from "./_chrome/BatchShell";

// Les listes du batch sont montees ICI, au plus haut niveau qui les consomme :
// la fiche d'une startup affiche ses membres, celle d'un fondateur sa startup,
// ses equipes et leurs classements, l'accueil les evenements et la cohorte. Montees sous /founders et
// /startups, chaque passage de l'un a l'autre desabonnerait puis relirait tout
// (lecon Trippple : garder l'abonnement EST le cache). Ce qui est au VISITEUR
// fondateur (ma shortlist / mes rencontres, les taches et mes coches) aussi :
// cible `null` s'il n'est pas fondateur du batch.
export default function BatchLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]">) {
  return (
    <BatchProvider>
      <FoundersProvider>
        <StartupsProvider>
          <EventsProvider>
            <ListsProvider>
              <CohortProvider>
                <LeaderboardsProvider>
                  <MyConnectionsProvider>
                    <TasksProvider>
                      <BatchShell>{children}</BatchShell>
                    </TasksProvider>
                  </MyConnectionsProvider>
                </LeaderboardsProvider>
              </CohortProvider>
            </ListsProvider>
          </EventsProvider>
        </StartupsProvider>
      </FoundersProvider>
    </BatchProvider>
  );
}
