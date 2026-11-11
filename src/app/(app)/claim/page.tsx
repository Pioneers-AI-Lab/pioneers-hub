"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Anchor, Button, Group, Modal, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { Founder, WithId } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useClaim } from "@/context/ClaimContext";
import { requestClaim } from "@/lib/accounts";
import { PROFILE_CATEGORY_LABEL } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageLoader } from "@/components/ui/PageLoader";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Rattacher son compte a son profil (SPECS §3.1, etape 3)
// ----------------------------
// L'accueil a deja essaye l'email du compte. Ici, le fondateur choisit son
// profil parmi les profils non reclames, comme dans Tricount ; le staff valide.
export default function ClaimPage() {
  const { firebaseUser, viewer, isLoading: isAuthLoading, memberships } = useAuth();
  const claim = useClaim();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<WithId<Founder> | null>(null);
  const [isSending, setIsSending] = useState(false);

  const batch = claim.batches.find((b) => b.id === claim.selectedBatchId) ?? null;
  const request = claim.requests.find((r) => r.batchId === claim.selectedBatchId) ?? null;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? claim.unclaimedFounders.filter((f) => f.name.toLowerCase().includes(q)) : claim.unclaimedFounders;
  }, [claim.unclaimedFounders, search]);

  if (isAuthLoading || claim.isLoading) return <PageLoader />;

  if (!firebaseUser) {
    return (
      <Stack py="xl" gap="md">
        <Title order={2}>Find your profile</Title>
        <Text c="dimmed">Sign in first, with the Google account of your onboarding email.</Text>
        <Button component={Link} href={paths.signIn(paths.claim())} size="md" maw={400}>
          Sign in
        </Button>
      </Stack>
    );
  }

  if (viewer?.roles.includes("staff")) {
    return (
      <Stack py="xl" gap="md">
        <Title order={2}>You are staff</Title>
        <Text c="dimmed">Staff accounts do not need a founder profile.</Text>
        <Anchor component={Link} href={paths.programs()}>
          Go to programs
        </Anchor>
      </Stack>
    );
  }

  if (memberships.length > 0) {
    const m = memberships[0];
    return (
      <Stack py="xl" gap="md">
        <Title order={2}>Your account is linked</Title>
        <Button component={Link} href={paths.batch(m.programId, m.batchId)} size="md" maw={400}>
          Open my batch
        </Button>
      </Stack>
    );
  }

  const send = async () => {
    if (!picked || !batch) return;
    setIsSending(true);
    try {
      await requestClaim(firebaseUser, batch, picked.id);
      setPicked(null);
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsSending(false);
    }
  };

  const requestedName = request ? claim.unclaimedFounders.find((f) => f.id === request.founderId)?.name : undefined;

  return (
    <Stack gap={0}>
      <Title order={2}>Find your profile</Title>
      <Text c="dimmed" mt={6}>
        We could not match <Text span c="white" inherit>{firebaseUser.email}</Text> to an imported profile.
        Choose yours below: the Pioneers team confirms it, usually within the day.
      </Text>

      {request?.status === "pending" && (
        <Section title="Request sent">
          <Text>
            You asked to be <Text span fw={600} inherit>{requestedName ?? "this profile"}</Text>
            {batch ? ` in ${batch.name}` : ""}. You will get access as soon as the team confirms.
          </Text>
          <Text size="sm" c="dimmed">
            Wrong profile? Choose another one below, it replaces your request.
          </Text>
        </Section>
      )}
      {request?.status === "rejected" && (
        <Section title="Request declined">
          <Text size="sm" c="dimmed">
            The team could not confirm your last request. Choose your profile again, or contact the Pioneers team.
          </Text>
        </Section>
      )}

      {claim.batches.length > 1 && (
        <Section title="Batch">
          <RowList>
            {claim.batches.map((b) => (
              <ButtonRow
                key={b.id}
                title={b.name}
                subtitle={claim.programsById.get(b.programId)?.name}
                meta={b.id === claim.selectedBatchId ? <Text size="sm" c="pioneers">Selected</Text> : undefined}
                onClick={() => claim.selectBatch(b.id)}
              />
            ))}
          </RowList>
        </Section>
      )}

      {batch && (
        <Section title={`Profiles not yet linked · ${batch.name}`}>
          <TextInput placeholder="Search your name" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          {claim.isUnclaimedLoading ? (
            <PageLoader />
          ) : filtered.length === 0 ? (
            <Empty>No profile matches. If you are not in the list, contact the Pioneers team.</Empty>
          ) : (
            <RowList>
              {filtered.map((f) => (
                <ButtonRow
                  key={f.id}
                  title={f.name}
                  subtitle={f.profileCategory ? PROFILE_CATEGORY_LABEL[f.profileCategory] : undefined}
                  avatar={{ name: f.name, photoUrl: f.photoUrl }}
                  meta={request?.founderId === f.id && request.status === "pending" ? "Requested" : undefined}
                  onClick={() => setPicked(f)}
                />
              ))}
            </RowList>
          )}
        </Section>
      )}

      {claim.batches.length === 0 && <Empty>No batch is open right now.</Empty>}

      <Modal opened={picked !== null} onClose={() => setPicked(null)} title="Is this you?" fullScreen={false}>
        <Stack>
          <Text>
            Link your account to <Text span fw={600} inherit>{picked?.name}</Text>? The team confirms it before
            you get access to the batch.
          </Text>
          <Group grow>
            <Button variant="default" size="md" onClick={() => setPicked(null)}>
              Cancel
            </Button>
            <Button size="md" loading={isSending} onClick={send}>
              This is me
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
