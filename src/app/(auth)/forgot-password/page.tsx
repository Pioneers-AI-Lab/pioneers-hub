"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Anchor, Button, Stack, Text, TextInput } from "@mantine/core";
import { authErrorMessage, sendResetPasswordEmail } from "@/lib/auth";
import { paths } from "@/lib/paths";
import { AuthCard } from "@/components/auth/AuthCard";
import { PageLoader } from "@/components/ui/PageLoader";

// Mot de passe oublie. Le message de succes est le meme que le compte existe
// ou non : la page ne dit pas quels emails ont un compte. `?email=` : l'email
// deja tape sur la page de connexion.
function ForgotPasswordForm() {
  const [email, setEmail] = useState(useSearchParams().get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await sendResetPasswordEmail(email);
      setSentTo(email.trim().toLowerCase());
    } catch (err) {
      // Compte inconnu : meme reponse qu'en cas de succes.
      if ((err as { code?: string }).code === "auth/user-not-found") setSentTo(email.trim().toLowerCase());
      else setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Anchor className="tap-link" component={Link} href={paths.signIn()} inherit>
      Back to sign in
    </Anchor>
  );

  if (sentTo) {
    return (
      <AuthCard title="Check your inbox" footer={back}>
        <Text>
          If an account exists for <Text span fw={600} inherit>{sentTo}</Text>, a link to choose a new password is on
          its way. Look in your spam folder too.
        </Text>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot your password?" subtitle="We email you a link to choose a new one." footer={back}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Stack gap="md">
          <TextInput label="Email" type="email" autoComplete="email" inputMode="email" required disabled={busy} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <Button type="submit" size="md" fullWidth loading={busy}>
            Send the link
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

export default function ForgotPasswordPage() {
  // `useSearchParams` suspend pendant le pre-rendu (cacheComponents).
  return (
    <Suspense fallback={<PageLoader />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
