"use client";

import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { AuthProvider } from "@/context/AuthContext";
import { theme } from "@/theme";

// Tout ce qui doit etre client a la racine tient ici : le root layout reste un
// composant serveur (chez Trippple, un root layout `"use client"` avec un garde
// `mounted` empechait tout rendu serveur).
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} forceColorScheme="dark">
      {/* En haut au centre : lisible sur mobile, sans masquer l'avatar du compte. */}
      <Notifications position="top-center" />
      <AuthProvider>{children}</AuthProvider>
    </MantineProvider>
  );
}
