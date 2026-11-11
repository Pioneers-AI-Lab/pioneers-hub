"use client";

import { useState } from "react";
import { Button, Stack, Text, Title } from "@mantine/core";
import { useAuth } from "@/context/AuthContext";
import { authErrorMessage, resendVerificationEmail } from "@/lib/auth";

/**
 * Compte cree par email, adresse pas encore confirmee : rien ne se rattache
 * avant (les regles exigent un email verifie). Le lien s'ouvre souvent dans un
 * autre onglet ou sur un autre appareil : « I have confirmed » relit le compte.
 */
export function VerifyEmailNotice() {
  const { firebaseUser, reloadUser, signOut } = useAuth();
  const [busy, setBusy] = useState<"check" | "resend" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (!firebaseUser) return null;

  const check = async () => {
    setBusy("check");
    setMessage(null);
    try {
      await reloadUser();
      if (!firebaseUser.emailVerified) setMessage("Not confirmed yet. Open the link in the email, then try again.");
    } catch (err) {
      setMessage(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setBusy("resend");
    setMessage(null);
    try {
      await resendVerificationEmail(firebaseUser);
      setMessage("A new link is on its way.");
    } catch (err) {
      setMessage(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap="md" py="xl" maw={440}>
      <Title order={2}>Confirm your email</Title>
      <Text c="dimmed">
        We sent a link to <Text span c="white" inherit>{firebaseUser.email}</Text>. Open it, then come back here: your
        founder profile links itself once the address is confirmed.
      </Text>
      <Button size="md" fullWidth loading={busy === "check"} disabled={busy !== null} onClick={check}>
        I have confirmed
      </Button>
      <Button size="md" fullWidth variant="default" loading={busy === "resend"} disabled={busy !== null} onClick={resend}>
        Send the link again
      </Button>
      {message && (
        <Text size="sm" c="dimmed" role="status">
          {message}
        </Text>
      )}
      <Button variant="subtle" color="gray" onClick={() => signOut()} w="fit-content" px={0}>
        Use another account
      </Button>
    </Stack>
  );
}
