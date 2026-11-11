"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Anchor, Button, Divider, Group, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useAuth } from "@/context/AuthContext";
import { authErrorMessage, registerWithEmail } from "@/lib/auth";
import { paths, safeNext, withNext } from "@/lib/paths";
import { AuthCard } from "@/components/auth/AuthCard";
import { PageLoader } from "@/components/ui/PageLoader";

// Creation de compte par email. Le compte recoit un lien de confirmation :
// l'accueil attend la confirmation avant de rattacher le profil.
function RegisterForm() {
  const { firebaseUser, isLoading, signInWithGoogle } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pendant la creation, le compte existe AVANT que le nom et l'email de
  // confirmation soient partis : on ne redirige qu'a la fin.
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isLoading && firebaseUser && !creating) router.replace(next ?? paths.home());
  }, [isLoading, firebaseUser, creating, next, router]);

  // La valeur est lue PENDANT l'evenement : dans la fonction de mise a jour,
  // executee plus tard, `currentTarget` vaut deja `null`.
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const submit = async () => {
    setError(null);
    setBusy("email");
    setCreating(true);
    try {
      await registerWithEmail(form.firstName, form.lastName, form.email, form.password);
      router.replace(next ?? paths.home());
    } catch (err) {
      setCreating(false);
      setError(authErrorMessage(err));
      setBusy(null);
    }
  };

  const google = async () => {
    setError(null);
    setBusy("google");
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(null);
    }
  };

  if (isLoading || (firebaseUser && !creating)) return <PageLoader />;

  return (
    <AuthCard
      title="Create your account"
      subtitle="Use the email of your onboarding form: your founder profile links itself once you confirm it."
      footer={
        <>
          Already have an account?{" "}
          <Anchor component={Link} href={withNext(paths.signIn(), next)} inherit>
            Sign in
          </Anchor>
        </>
      }
    >
      <Button size="md" fullWidth loading={busy === "google"} disabled={busy !== null} onClick={google}>
        Continue with Google
      </Button>

      <Divider label="or with your email" labelPosition="center" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Stack gap="md">
          <Group grow align="flex-start" gap="sm">
            <TextInput label="First name" autoComplete="given-name" required disabled={busy !== null} value={form.firstName} onChange={set("firstName")} />
            <TextInput label="Last name" autoComplete="family-name" required disabled={busy !== null} value={form.lastName} onChange={set("lastName")} />
          </Group>
          <TextInput label="Email" type="email" autoComplete="email" inputMode="email" required disabled={busy !== null} value={form.email} onChange={set("email")} />
          <PasswordInput
            label="Password"
            description="At least 6 characters."
            autoComplete="new-password"
            required
            minLength={6}
            disabled={busy !== null}
            value={form.password}
            onChange={set("password")}
          />
          <Button type="submit" size="md" fullWidth variant="default" loading={busy === "email"} disabled={busy !== null}>
            Create account
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

export default function RegisterPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <RegisterForm />
    </Suspense>
  );
}
