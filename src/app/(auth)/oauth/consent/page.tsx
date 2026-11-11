"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Stack, Text } from "@mantine/core";
import type { CallableResponse } from "@shared/callables";
import { useAuth } from "@/context/AuthContext";
import { call } from "@/lib/firebase";
import { paths } from "@/lib/paths";
import { AuthCard } from "@/components/auth/AuthCard";
import { PageLoader } from "@/components/ui/PageLoader";

// ----------------------------
// Consentement OAuth : brancher Claude sur Pioneers Hub
// ----------------------------
// Claude (claude.ai ou Claude Code) envoie ici la personne qui connecte le
// serveur MCP (functions/src/oauth). Elle se connecte si besoin, voit QUI
// demande l'acces et avec QUEL compte, puis accepte ou refuse : le navigateur
// repart alors vers le client, avec un code ou un refus.
//
// Aucune cle n'est creee ni copiee (SPECS §4.8) : le client recoit des jetons
// qu'il renouvelle seul, et que le staff peut revoquer.
//
// Un seul verrou, relache seulement sur erreur : en cas de succes c'est la
// redirection qui termine l'action (comme la page de connexion).

type Described = CallableResponse<"oauthDescribeRequest">;

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Start the connection again from Claude.";
}

function Consent() {
  const { firebaseUser, isLoading, signOut } = useAuth();
  const router = useRouter();
  const requestId = useSearchParams().get("request") ?? "";
  const [described, setDescribed] = useState<Described | null>(null);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pas connecte : la connexion revient ici une fois faite.
  useEffect(() => {
    if (!isLoading && !firebaseUser) router.replace(paths.signIn(paths.oauthConsent(requestId)));
  }, [isLoading, firebaseUser, requestId, router]);

  useEffect(() => {
    if (!firebaseUser || !requestId) return;
    let alive = true;
    call("oauthDescribeRequest")({ requestId })
      .then(({ data }) => alive && setDescribed(data))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [firebaseUser, requestId]);

  const decide = async (approve: boolean) => {
    setError(null);
    setBusy(approve ? "allow" : "deny");
    try {
      const { data } = await call("oauthDecide")({ requestId, approve });
      window.location.assign(data.redirectUrl);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  if (isLoading || !firebaseUser) return <PageLoader />;

  if (!requestId || (error && !described)) {
    return (
      <AuthCard title="Connect Claude" subtitle={error ?? "This link is incomplete. Start the connection again from Claude."}>
        <Button size="md" fullWidth variant="default" onClick={() => router.replace(paths.home())}>
          Back to Pioneers Hub
        </Button>
      </AuthCard>
    );
  }

  if (!described) return <PageLoader />;

  return (
    <AuthCard
      title="Connect Claude"
      subtitle={
        <>
          <b>{described.clientName}</b> wants to access Pioneers Hub as <b>{firebaseUser.email}</b>.
        </>
      }
      footer={
        <>
          Not you?{" "}
          <Text component="button" type="button" inherit c="dimmed" td="underline" bg="none" bd={0} p={0} onClick={() => void signOut(paths.signIn(paths.oauthConsent(requestId)))}>
            Use another account
          </Text>
        </>
      }
    >
      <Stack gap="xs">
        <Text size="sm">It will read the batch data and write to it with your rights.</Text>
        <Text size="sm" c="dimmed">
          Every write is shown to you and confirmed first, and logged with your name. Nothing can be deleted.
        </Text>
        <Text size="sm" c="dimmed">
          You will be sent back to <b>{described.redirectHost}</b>.
        </Text>
      </Stack>

      <Stack gap="sm">
        {described.canApprove ? (
          <Button size="md" fullWidth loading={busy === "allow"} disabled={busy !== null} onClick={() => void decide(true)}>
            Allow
          </Button>
        ) : (
          <Text size="sm" c="red.4" role="alert">
            {described.reason}
          </Text>
        )}
        <Button size="md" fullWidth variant="default" loading={busy === "deny"} disabled={busy !== null} onClick={() => void decide(false)}>
          {described.canApprove ? "Deny" : "Back to Claude"}
        </Button>
      </Stack>

      {error && (
        <Text size="sm" c="red.4" role="alert">
          {error}
        </Text>
      )}
    </AuthCard>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Consent />
    </Suspense>
  );
}
