"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Anchor, Button, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { notifications } from "@mantine/notifications";
import type { Founder, WithId } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useClaim } from "@/context/ClaimContext";
import { claimProfile } from "@/lib/accounts";
import { needsEmailVerification } from "@/lib/auth";
import { PROFILE_CATEGORY_LABEL, formatPeriod } from "@/lib/format";
import { paths } from "@/lib/paths";
import { VerifyEmailNotice } from "@/components/auth/VerifyEmailNotice";
import { PageLoader } from "@/components/ui/PageLoader";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Rattacher son compte a son profil (SPECS §3.1, « comme Tricount »)
// ----------------------------
// L'accueil a deja essaye l'email du compte. Ici, le fondateur choisit son
// batch, puis son nom parmi les profils non reclames : son compte est relie
// tout de suite et il entre dans l'espace du batch. Le staff voit chaque
// rattachement (Admin > Founder profiles) et peut delier. Un profil par batch : un batch
// ou le compte est deja rattache ne propose plus de profil. Le profil choisi
// peut porter un autre email que le compte (un fondateur importe avec une
// adresse, connecte avec une autre).
export default function ClaimPage() {
  const router = useRouter();
  const { firebaseUser, viewer, isLoading: isAuthLoading } = useAuth();
  const claim = useClaim();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<WithId<Founder> | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const batch = claim.batches.find((b) => b.id === claim.selectedBatchId) ?? null;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? claim.unclaimedFounders.filter((f) => f.name.toLowerCase().includes(q)) : claim.unclaimedFounders;
  }, [claim.unclaimedFounders, search]);

  if (isAuthLoading || claim.isLoading) return <PageLoader />;

  if (!firebaseUser) {
    return (
      <Stack py="xl" gap="md">
        <Title order={2}>Find your profile</Title>
        <Text c="dimmed">Sign in first, or create your account.</Text>
        <Button component={Link} href={paths.signIn(paths.claim())} size="md" maw={400}>
          Sign in
        </Button>
        <Anchor className="tap-link" component={Link} href={paths.register()} size="sm">
          Create an account
        </Anchor>
      </Stack>
    );
  }

  if (needsEmailVerification(firebaseUser)) return <VerifyEmailNotice />;

  if (viewer?.roles.includes("staff")) {
    return (
      <Stack py="xl" gap="md">
        <Title order={2}>You are staff</Title>
        <Text c="dimmed">Staff accounts do not need a founder profile.</Text>
        <Anchor className="tap-link" component={Link} href={paths.programs()}>
          Go to programs
        </Anchor>
      </Stack>
    );
  }

  const linkedHere = batch !== null && claim.linkedBatchIds.has(batch.id);

  const confirm = async () => {
    if (!picked) return;
    setIsClaiming(true);
    try {
      await claimProfile(firebaseUser, picked);
      notifications.show({ message: `Welcome, ${picked.name.split(" ")[0]}.` });
      router.replace(paths.batch(picked.programId, picked.batchId));
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
      setIsClaiming(false);
    }
  };

  return (
    <Stack gap={0}>
      <Title order={2}>Find your profile</Title>
      <Text c="dimmed" mt={6}>
        Pick your name in your batch: your account (<Text span c="white" inherit>{firebaseUser.email}</Text>) is linked
        right away.
      </Text>

      {claim.batches.length > 1 && (
        <Section title="Your batch">
          <RowList>
            {claim.batches.map((b) => (
              <ButtonRow
                key={b.id}
                title={b.name}
                subtitle={[claim.programsById.get(b.programId)?.name, formatPeriod(b.startDayString, b.endDayString)].filter(Boolean).join(" · ")}
                meta={
                  b.id === claim.selectedBatchId ? (
                    <Text size="sm" c="pioneers">Selected</Text>
                  ) : claim.linkedBatchIds.has(b.id) ? (
                    <Text size="sm" c="dimmed">Linked</Text>
                  ) : undefined
                }
                onClick={() => {
                  claim.selectBatch(b.id);
                  setSearch("");
                }}
              />
            ))}
          </RowList>
        </Section>
      )}

      {batch && linkedHere && (
        <Section title={batch.name}>
          <Text size="sm">Your account is already linked to a profile in this batch.</Text>
          <Button component={Link} href={paths.batch(batch.programId, batch.id)} size="md" maw={400}>
            Open {batch.name}
          </Button>
        </Section>
      )}

      {batch && !linkedHere && (
        <Section title={`Not yet linked · ${batch.name}`}>
          <TextInput placeholder="Search your name" value={search} onChange={(e) => setSearch(e.currentTarget.value)} type="search" />
          {claim.isUnclaimedLoading ? (
            <PageLoader />
          ) : filtered.length === 0 ? (
            <Empty>
              {claim.unclaimedFounders.length === 0
                ? "Every profile of this batch is already linked. Contact the Pioneers team if yours is taken."
                : "No profile matches. If you are not in the list, contact the Pioneers team."}
            </Empty>
          ) : (
            <RowList>
              {filtered.map((f) => (
                <ButtonRow
                  key={f.id}
                  title={f.name}
                  subtitle={f.profileCategory ? PROFILE_CATEGORY_LABEL[f.profileCategory] : undefined}
                  avatar={{ name: f.name, photoUrl: f.photoUrl }}
                  onClick={() => setPicked(f)}
                />
              ))}
            </RowList>
          )}
        </Section>
      )}

      {claim.batches.length === 0 && <Empty>No batch yet.</Empty>}

      <ResponsiveDialog opened={picked !== null} onClose={() => setPicked(null)} title="Is this you?">
        <Stack>
          <Text>
            Link your account to <Text span fw={600} inherit>{picked?.name}</Text>
            {batch ? ` in ${batch.name}` : ""}? You get access to the batch right away. Picking someone else&apos;s
            profile is visible to the Pioneers team.
          </Text>
          <Group grow>
            <Button variant="default" size="md" onClick={() => setPicked(null)}>
              Cancel
            </Button>
            <Button size="md" loading={isClaiming} onClick={confirm}>
              This is me
            </Button>
          </Group>
        </Stack>
      </ResponsiveDialog>
    </Stack>
  );
}
