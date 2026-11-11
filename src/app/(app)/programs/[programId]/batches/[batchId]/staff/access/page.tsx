"use client";

import { useState } from "react";
import { Box, Button, Code, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { ClaimRequest, Founder, InvestorAccess, UserRole, WithId } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useStaff } from "@/context/StaffContext";
import { approveClaim, rejectClaim, setUserRoles, unlinkFounder } from "@/lib/accounts";
import { formatDay, formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Acces (SPECS §3.2) : rattachements de comptes et roles de l'equipe
// ----------------------------
// - Demandes « c'est moi » a valider (le rattachement par email, lui, est
//   automatique et ne passe pas ici).
// - Profils rattaches : delier un compte.
// - Roles des comptes de l'equipe (staff, investors). Inviter par email
//   demande le SDK admin : `npm run grant` en attendant la callable.

type RoleChoice = "none" | "staff" | "investor_ic" | "investor_portfolio";

const roleChoiceOf = (roles: UserRole[], access: InvestorAccess | null): RoleChoice =>
  roles.includes("staff") ? "staff" : roles.includes("investor") ? (access === "ic" ? "investor_ic" : "investor_portfolio") : "none";

export default function AccessPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { firebaseUser } = useAuth();
  const { founders, foundersById } = useFounders();
  const { claimRequests, users, isLoading } = useStaff();
  const [busy, setBusy] = useState<string | null>(null);
  const [toUnlink, setToUnlink] = useState<WithId<Founder> | null>(null);

  if (isLoading) return <PageLoader />;

  const staffUid = firebaseUser!.uid;
  const pending = claimRequests.filter((r) => r.status === "pending");
  const linked = founders.filter((f) => f.uid).sort((a, b) => (b.claimedDateISOString ?? "").localeCompare(a.claimedDateISOString ?? ""));
  const notLinked = founders.length - linked.length;
  const team = users.filter((u) => u.roles.length > 0);
  const founderOfUid = new Map(founders.filter((f) => f.uid).map((f) => [f.uid!, f]));

  const act = async (key: string, fn: () => Promise<void>, done: string) => {
    setBusy(key);
    try {
      await fn();
      notifications.show({ message: done });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const decide = (r: WithId<ClaimRequest>, approve: boolean) =>
    act(r.id, () => (approve ? approveClaim(r, staffUid) : rejectClaim(r, staffUid)), approve ? "Account linked" : "Request declined");

  return (
    <>
      <PageHeader back={{ href: paths.staff(program.id, batch.id), label: "Staff" }} title="Access" />

      <Section title={`Requests to confirm · ${pending.length}`} hint="Accounts whose email did not match a profile, and who picked one.">
        {pending.length === 0 ? (
          <Empty>No request waiting.</Empty>
        ) : (
          <RowList>
            {pending.map((r) => {
              const founder = foundersById.get(r.founderId);
              return (
                <Stack key={r.id} gap="xs" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
                  <Box>
                    <Text fw={500}>
                      {r.displayName ?? r.email} <Text span c="dimmed" inherit>wants to be</Text> {founder?.name ?? "an unknown profile"}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {r.email} · {formatDateTime(r.createdDateISOString)}
                    </Text>
                  </Box>
                  <Group grow>
                    <Button variant="default" size="md" disabled={busy !== null} onClick={() => decide(r, false)}>
                      Decline
                    </Button>
                    <Button size="md" loading={busy === r.id} disabled={busy !== null && busy !== r.id || !founder || founder.uid !== null} onClick={() => decide(r, true)}>
                      Confirm
                    </Button>
                  </Group>
                  {founder?.uid && (
                    <Text size="xs" c="red.4">
                      This profile is already linked to another account.
                    </Text>
                  )}
                </Stack>
              );
            })}
          </RowList>
        )}
      </Section>

      <Section title={`Linked profiles · ${linked.length}`} hint={`${notLinked} profiles are not linked yet. They link themselves when the founder signs in with the onboarding email.`}>
        {linked.length === 0 ? (
          <Empty>No account linked yet.</Empty>
        ) : (
          <RowList>
            {linked.map((f) => (
              <Row
                key={f.id}
                avatar={{ name: f.name, photoUrl: f.photoUrl }}
                title={f.name}
                subtitle={`Linked ${formatDay(f.claimedDateISOString?.slice(0, 10))}`}
                meta={
                  <Button variant="subtle" color="gray" onClick={() => setToUnlink(f)}>
                    Unlink
                  </Button>
                }
              />
            ))}
          </RowList>
        )}
      </Section>

      <Section
        title={`Team accounts · ${team.length}`}
        hint={
          <>
            To invite someone by email, run <Code>npm run grant -- email staff</Code> (or <Code>investor ic</Code>). Their
            role is ready at their first sign-in.
          </>
        }
      >
        <RowList>
          {team.map((u) => {
            const founder = founderOfUid.get(u.id);
            const choice = roleChoiceOf(u.roles, u.investorAccess);
            return (
              <Row
                key={u.id}
                title={u.id === staffUid ? "You" : (founder?.name ?? `Account ${u.id.slice(0, 6)}`)}
                subtitle={`Last seen ${formatDay(u.lastSeenDateISOString.slice(0, 10))}`}
                meta={
                  <Select
                    size="sm"
                    w={150}
                    aria-label="Role"
                    disabled={u.id === staffUid || busy !== null}
                    value={choice}
                    allowDeselect={false}
                    data={[
                      { value: "staff", label: "Staff" },
                      { value: "investor_ic", label: "Investor IC" },
                      { value: "investor_portfolio", label: "Investor" },
                      { value: "none", label: "No role" },
                    ]}
                    onChange={(v) => {
                      const next = (v ?? "none") as RoleChoice;
                      const roles: UserRole[] = next === "staff" ? ["staff"] : next === "none" ? [] : ["investor"];
                      const access: InvestorAccess | null = next === "investor_ic" ? "ic" : next === "investor_portfolio" ? "portfolio" : null;
                      void act(u.id, () => setUserRoles(u.id, roles, access), "Role updated");
                    }}
                  />
                }
              />
            );
          })}
        </RowList>
      </Section>

      <Modal opened={toUnlink !== null} onClose={() => setToUnlink(null)} title="Unlink this account?">
        <Stack>
          <Text>
            {toUnlink?.name} loses access to {batch.name} until the profile is linked again. The profile itself is kept.
          </Text>
          <Group grow>
            <Button variant="default" size="md" onClick={() => setToUnlink(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              size="md"
              loading={busy === "unlink"}
              onClick={() =>
                toUnlink && act("unlink", () => unlinkFounder(toUnlink), "Account unlinked").then(() => setToUnlink(null))
              }
            >
              Unlink
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
