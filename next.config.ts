import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
