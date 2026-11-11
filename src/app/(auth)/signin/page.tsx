"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Button, Center, Stack, Text, Title } from "@mantine/core";
import { useAuth } from "@/context/AuthContext";
import { paths } from "@/lib/paths";

// Messages lisibles pour les erreurs de la fenetre Google les plus courantes.
function readableError(err: { code?: string; message: string }): string | null {
  if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return null;
  if (err.code === "auth/popup-blocked") return "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.";
  return err.message;
}

function SignInCard() {
  const { firebaseUser, isLoading, signInWithGoogle } = useAuth();
  const router = useRouter();
  // L'accueil decide ensuite : batch du fondateur, rattachement, ou programmes.
  const next = useSearchParams().get("next") ?? paths.home();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Deja connecte : on repart d'ou l'on venait.
  useEffect(() => {
    if (!isLoading && firebaseUser) router.replace(next);
  }, [isLoading, firebaseUser, next, router]);

  return (
    <Box w="100%" maw={400} px="md">
      <Stack gap="lg">
        <Stack gap={6}>
          <Title order={1}>
            Pioneers <Text span c="pioneers" inherit>Hub</Text>
          </Title>
          <Text c="dimmed">
            Sign in with the Google account of the email you used for the onboarding form. Your profile is
            linked automatically.
          </Text>
        </Stack>
        <Button
          size="md"
          fullWidth
          loading={isLoading || isPending}
          onClick={() => {
            setError(null);
            setIsPending(true);
            signInWithGoogle()
              .catch((err: { code?: string; message: string }) => setError(readableError(err)))
              .finally(() => setIsPending(false));
          }}
        >
          Continue with Google
        </Button>
        {error && (
          <Text size="sm" c="red.4">
            {error}
          </Text>
        )}
      </Stack>
    </Box>
  );
}

export default function SignInPage() {
  return (
    <Center mih="100dvh">
      {/* `useSearchParams` suspend pendant le pre-rendu (cacheComponents). */}
      <Suspense>
        <SignInCard />
      </Suspense>
    </Center>
  );
}
