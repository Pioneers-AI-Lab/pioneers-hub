import { Suspense } from "react";
import type { Metadata } from "next";
import { AnimatedBackdrop } from "@/components/auth/AnimatedBackdrop";
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
  title: "Form · Pioneers Hub",
  description: "Answer a Pioneers form.",
  robots: { index: false, follow: false },
};

export default function PublicFormLayout({ children }: LayoutProps<"/forms/[formId]">) {
  return (
    <div className="auth-page">
      <AnimatedBackdrop />
      <div aria-hidden className="form-veil" />
      {/* Au-dessus du voile : chargement et refus compris, pas seulement le formulaire. */}
      <div className="form-content">
        <Suspense fallback={<PageLoader />}>
          <PublicFormProvider>{children}</PublicFormProvider>
        </Suspense>
      </div>
    </div>
  );
}
