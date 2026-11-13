"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { paths } from "@/lib/paths";
import { PageLoader } from "@/components/ui/PageLoader";

/**
 * /me et /me/edit ne sont plus que des raccourcis (menu du compte, anciens
 * liens) vers SA fiche, /founders/{son id} : une seule page de profil. Monte
 * sous MeGate, qui garantit le rattachement.
 */
export function RedirectToSelf({ edit = false }: { edit?: boolean }) {
  const router = useRouter();
  const { program } = useProgram();
  const { batch, viewerFounderId } = useBatch();
  useEffect(() => {
    if (!viewerFounderId) return;
    router.replace(edit ? paths.founderEdit(program.id, batch.id, viewerFounderId) : paths.founder(program.id, batch.id, viewerFounderId));
  }, [router, edit, program.id, batch.id, viewerFounderId]);
  return <PageLoader />;
}
