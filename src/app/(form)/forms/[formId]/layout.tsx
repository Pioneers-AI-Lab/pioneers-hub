import { Suspense } from "react";
import type { Metadata } from "next";
import { AnimatedBackdrop } from "@/components/auth/AnimatedBackdrop";
import { IS_LOCAL_DB, LocalDbBadge } from "@/components/chrome/LocalDbBadge";
import { PageLoader } from "@/components/ui/PageLoader";
import { PublicFormProvider } from "@/context/PublicFormContext";

// ----------------------------
// Formulaire public : hors de la coque de l'application
// ----------------------------
// Ni en-tete ni onglets : une question par ecran, plein ecran, sur le fond
// anime des pages de connexion (voile plus sombre, pour la lecture). Le serveur
// Next ne lit aucune donnee : l'apercu du lien ne porte pas le titre du
// formulaire. La frontiere Suspense est exigee par `useParams` (cacheComponents).

export const metadata: Metadata = {
  title: "Form",
  description: "Answer a Pioneers form.",
  robots: { index: false, follow: false },
};

export default function PublicFormLayout({ children }: LayoutProps<"/forms/[formId]">) {
  return (
    <div className="auth-page">
      {/* Les questions s'y lisent sans carte : voile sombre sur la trame. */}
      <AnimatedBackdrop veil />
      {/* « local db » sur les emulateurs, au coin : le formulaire n'a pas l'en-tete de l'application. */}
      {IS_LOCAL_DB && (
        <div style={{ position: "fixed", top: 8, right: 12, zIndex: 2, display: "flex" }}>
          <LocalDbBadge />
        </div>
      )}
      {/* Au-dessus du voile : chargement et refus compris, pas seulement le formulaire. */}
      <div className="backdrop-content">
        <Suspense fallback={<PageLoader />}>
          <PublicFormProvider>{children}</PublicFormProvider>
        </Suspense>
      </div>
    </div>
  );
}
