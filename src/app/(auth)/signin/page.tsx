"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Anchor, Button, Divider, Group, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useAuth } from "@/context/AuthContext";
import { authErrorMessage, signInWithEmail } from "@/lib/auth";
import { paths, safeNext, withNext } from "@/lib/paths";
import { AuthCard } from "@/components/auth/AuthCard";
import { PageLoader } from "@/components/ui/PageLoader";

// ----------------------------
// Connexion : Google, ou email et mot de passe (comme Trippple)
// ----------------------------
// UN SEUL VERROU pour toute la page, qui ne se relache que sur erreur : en cas
// de succes, c'est la redirection qui termine l'action (lecon Trippple : un
// bouton rearme avant la navigation laissait rejouer la connexion).
function SignInForm() {
  const { firebaseUser, isLoading, signInWithGoogle } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Connecte : l'accueil aiguille (batch, rattachement, confirmation d'email).
  useEffect(() => {
    if (!isLoading && firebaseUser) router.replace(next ?? paths.home());
  }, [isLoading, firebaseUser, next, router]);

  const run = async (kind: "google" | "email", action: () => Promise<void>) => {
    setError(null);
    setBusy(kind);
    try {
      await action();
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(null);
    }
  };

  if (isLoading || firebaseUser) return <PageLoader />;

  return (
    <AuthCard
      title="Sign in"
      subtitle="Use the email of your onboarding form: your founder profile links itself."
      footer={
        <>
          No account yet?{" "}
          <Anchor component={Link} href={withNext(paths.register(), next)} inherit>
            Create one
          </Anchor>
          {" · "}
          <Anchor component={Link} href={paths.programs()} inherit c="dimmed">
            Browse programs
          </Anchor>
        </>
      }
    >
      <Button size="md" fullWidth loading={busy === "google"} disabled={busy !== null} onClick={() => run("google", signInWithGoogle)}>
        Continue with Google
      </Button>

      <Divider label="or with your email" labelPosition="center" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run("email", () => signInWithEmail(email, password));
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            disabled={busy !== null}
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <Stack gap={6}>
            <PasswordInput
              label="Password"
              autoComplete="current-password"
              required
              disabled={busy !== null}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Anchor className="tap-link" component={Link} href={paths.forgotPassword(email.trim() || undefined)} size="sm" c="dimmed">
                Forgot password?
              </Anchor>
            </Group>
          </Stack>
          <Button type="submit" size="md" fullWidth variant="default" loading={busy === "email"} disabled={busy !== null}>
            Sign in
          </Button>
        </Stack>
      </form>

      {error && (
        <Text size="sm" c="red.4" role="alert">
          {error}
        </Text>
      )}
    </AuthCard>
  );
}

export default function SignInPage() {
  // `useSearchParams` suspend pendant le pre-rendu (cacheComponents).
  return (
    <Suspense fallback={<PageLoader />}>
      <SignInForm />
    </Suspense>
  );
}
