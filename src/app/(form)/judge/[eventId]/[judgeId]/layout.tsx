import { Suspense } from "react";
import type { Metadata } from "next";
import { Container } from "@mantine/core";
import { PageLoader } from "@/components/ui/PageLoader";
import { JudgeSheetProvider } from "@/context/JudgeSheetContext";

// ----------------------------
// Jury : hors de la coque de l'application (pas de compte, ni en-tete ni onglets)
// ----------------------------
// La frontiere Suspense est exigee par `useParams` (cacheComponents).

export const metadata: Metadata = {
  title: "Jury · Pioneers Hub",
  description: "Score the teams of a Pioneers event.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function JudgeLayout({ children }: LayoutProps<"/judge/[eventId]/[judgeId]">) {
  return (
    <Container size={640} px="md" py="xl">
      <Suspense fallback={<PageLoader />}>
        <JudgeSheetProvider>{children}</JudgeSheetProvider>
      </Suspense>
    </Container>
  );
}
