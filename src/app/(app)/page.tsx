"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Stack, Title } from "@mantine/core";
import { useAuth } from "@/context/AuthContext";
import { autoClaimByEmail } from "@/lib/accounts";
import { needsEmailVerification } from "@/lib/auth";
import { VerifyEmailNotice } from "@/components/auth/VerifyEmailNotice";
import { paths } from "@/lib/paths";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";

// ----------------------------
// Accueil : aiguillage selon le visiteur
// ----------------------------
//   non connecte          la page de connexion (entree unique, meme ecran que /signin)
//   staff ou investor     les programmes
//   fondateur d'un batch  son batch (de plusieurs : le choix)
//   email non confirme    confirmation d'abord (compte cree par mot de passe)
//   connecte sans profil  rattachement automatique par email, sinon /claim
export default function HomePage() {
  const { firebaseUser, viewer, isLoading, memberships, isMembershipsLoading } = useAuth();
  const router = useRouter();
  const claimTried = useRef(false);

  const isTeam = viewer !== null && (viewer.roles.includes("staff") || viewer.roles.includes("investor"));
  // Valeur simple : apres la confirmation de l'email, `firebaseUser` est le MEME
  // objet (modifie sur place par `reload()`) et l'effet ne se relancerait pas.
  const awaitsVerification = needsEmailVerification(firebaseUser);

  useEffect(() => {
    if (isLoading) return;
    if (!firebaseUser) {
      router.replace(paths.signIn());
      return;
    }
    if (isMembershipsLoading) return;
    if (isTeam) {
      router.replace(paths.programs());
      return;
    }
    if (memberships.length === 1) {
      router.replace(paths.batch(memberships[0].programId, memberships[0].batchId));
      return;
    }
    if (memberships.length > 1 || claimTried.current || awaitsVerification) return;
    // Aucun profil rattache : on essaie l'email du compte, puis le choix du profil.
    claimTried.current = true;
    autoClaimByEmail(firebaseUser)
      .then((claimed) => {
        if (claimed.length > 0) router.replace(paths.batch(claimed[0].programId, claimed[0].batchId));
        else router.replace(paths.claim());
      })
      .catch((err) => {
        console.error("auto claim failed", err);
        router.replace(paths.claim());
      });
  }, [isLoading, isMembershipsLoading, firebaseUser, awaitsVerification, isTeam, memberships, router]);

  // Non connecte : redirection vers /signin en cours.
  if (isLoading || isMembershipsLoading || !firebaseUser) return <PageLoader />;

  if (awaitsVerification && !isTeam) return <VerifyEmailNotice />;

  if (memberships.length > 1) {
    return (
      <Stack gap="md">
        <Title order={2}>Your batches</Title>
        <RowList>
          {memberships.map((m) => (
            <LinkRow key={m.id} href={paths.batch(m.programId, m.batchId)} title={m.batchId} subtitle={m.programId} />
          ))}
        </RowList>
      </Stack>
    );
  }

  // Redirection en cours (programmes, batch ou rattachement).
  return <PageLoader />;
}
