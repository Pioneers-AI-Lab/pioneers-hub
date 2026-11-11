import { Suspense } from "react";
import { AppChrome } from "@/components/chrome/AppChrome";
import { PageLoader } from "@/components/ui/PageLoader";

// Validation « navigation instantanee » de Next (dev seulement) desactivee pour
// tout l'arbre : chaque niveau lit Firestore cote client et attend sa premiere
// reponse (LevelGate). Une navigation n'est donc pas instantanee PAR CONCEPTION,
// et le serveur n'a aucune donnee a mettre en cache. A reactiver segment par
// segment le jour ou une page lira des donnees cote serveur.
export const instant = false;

// ----------------------------
// La coque de l'application
// ----------------------------
// PAS DE GARDE DE CONNEXION ICI, contrairement a Trippple : programmes, batchs,
// fondateurs et startups ont une vue publique. Chaque niveau decide de ce que
// le visiteur peut lire (role calcule par le BatchContext), et les sous-arbres
// reserves au staff poseront leur propre garde.
//
// UNE SEULE FRONTIERE Suspense, ici. Avec `cacheComponents`, `useParams` d'une
// route dynamique suspend pendant le pre-rendu ; sans frontiere au-dessus, le
// build echoue. Toutes les donnees sont lues cote client (Firestore temps
// reel) : la coque pre-rendue est ce chargement, puis le client prend la main.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppChrome>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </AppChrome>
  );
}
