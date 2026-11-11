import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Un build de verification (emulateurs) peut tourner a cote de `next dev` sans
  // se marcher dessus : NEXT_DIST_DIR=.next-emu next build && next start.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Toutes les donnees sont lues cote client (Firestore temps reel) : une
    // navigation attend sa premiere reponse PAR CONCEPTION, et la validation
    // implicite de « navigation instantanee » signalait chaque page en dev.
    // Seuls les segments qui exportent `instant` sont valides ; a utiliser le
    // jour ou une page lira des donnees cote serveur.
    instantInsights: { validationLevel: "manual-warning" },
  },
};

export default nextConfig;
