"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Checkbox, Group, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import type { AccountAccess, AccountRow } from "@shared/callables";
import type { InvestorAccess, UserRole } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useAction } from "@/hooks/useAction";
import { useCallable } from "@/hooks/useCallable";
import { call } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Admin > Access : tous les comptes, leurs droits, invitation et blocage
// ----------------------------
// Les droits s'ecrivent cote serveur (callables `listAccounts`, `inviteAccount`,
// `setAccountAccess`, `setAccountDisabled`) : chaque changement est journalise
// dans `auditLogs`. Le role fondateur ne se donne pas ici : il vient du
// rattachement a un profil (import, puis connexion).

const ROLE_LABELS: Record<UserRole, string> = { staff: "Staff", investor: "Investor", mentor: "Mentor" };
const NO_ACCESS: AccountAccess = { roles: [], investorAccess: null };

/** Resume des droits d'un compte, pour la ligne de la liste. */
function accessSummary(account: AccountRow): string {
  const parts = account.roles.map((r) =>
    r === "investor" ? `Investor (${account.investorAccess === "ic" ? "IC" : "portfolio"})` : ROLE_LABELS[r],
  );
  if (account.founderOf.length > 0) parts.push(`Founder · ${account.founderOf.map((m) => m.batchId).join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : "No access";
}

/** Roles cumulables, et niveau d'acces quand le role investor est coche. */
function AccessEditor({ value, onChange }: { value: AccountAccess; onChange: (next: AccountAccess) => void }) {
  return (
    <Stack gap="sm">
      <Checkbox.Group
        label="Roles"
        description="A founder gets access through their profile, not here."
        value={value.roles}
        onChange={(roles) => {
          const next = roles as UserRole[];
          onChange({
            roles: next,
            investorAccess: next.includes("investor") ? (value.investorAccess ?? "portfolio") : null,
          });
        }}
      >
        <Stack gap="xs" mt="xs">
          <Checkbox value="staff" label="Staff · every tool and every piece of data" />
          <Checkbox value="investor" label="Investor · the investor space" />
          <Checkbox value="mentor" label="Mentor · no access yet (bonus)" />
        </Stack>
      </Checkbox.Group>
      {value.roles.includes("investor") && (
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Investor access
          </Text>
          <SegmentedControl
            value={value.investorAccess ?? "portfolio"}
            onChange={(v) => onChange({ ...value, investorAccess: v as InvestorAccess })}
            data={[
              { value: "ic", label: "IC · everything, read only" },
              { value: "portfolio", label: "Portfolio · no notes" },
            ]}
          />
        </Stack>
      )}
    </Stack>
  );
}

export default function AdminAccessPage() {
  const { viewer } = useAuth();
  const { data, error, isLoading, reload } = useCallable("listAccounts", {});
  const accounts = data?.accounts ?? null;
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AccountRow | null>(null);
  const [draft, setDraft] = useState<AccountAccess>(NO_ACCESS);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteAccess, setInviteAccess] = useState<AccountAccess>({ roles: ["staff"], investorAccess: null });
  const { isBusy, run: runAction } = useAction();
  // Le bouton qui tourne : celui de la derniere action lancee.
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const busy = isBusy ? busyLabel : null;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!accounts || !q) return accounts ?? [];
    return accounts.filter((a) => `${a.email ?? ""} ${a.displayName ?? ""}`.toLowerCase().includes(q));
  }, [accounts, search]);

  const run = async (label: string, action: () => Promise<unknown>, success: string) => {
    setBusyLabel(label);
    const ok = (await runAction(action, success)) !== undefined;
    if (ok) reload();
    return ok;
  };

  const open = (account: AccountRow) => {
    setSelected(account);
    setDraft({ roles: account.roles, investorAccess: account.investorAccess });
  };

  const invite = async () => {
    const email = inviteEmail.trim();
    const ok = await run("invite", () => call("inviteAccount")({ email, ...inviteAccess }), `${email} can now sign in with this email.`);
    if (ok) setInviteEmail("");
  };

  if (isLoading) return <PageLoader />;
  if (!accounts) return <Empty>{error}</Empty>;
  const isSelf = selected?.uid === viewer?.uid;

  return (
    <>
      <PageHeader
        back={{ href: paths.admin(), label: "Admin" }}
        title="Access"
        subtitle="Every account and its access. Each change is logged."
      />

      <Section
        title="Invite"
        hint="The account is ready before the first sign-in: the person signs in with Google (or a password) on this exact email and already has these roles."
      >
        <Stack>
          <TextInput
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="name@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.currentTarget.value)}
          />
          <AccessEditor value={inviteAccess} onChange={setInviteAccess} />
          <Button size="md" fullWidth loading={busy === "invite"} disabled={!inviteEmail.trim() || busy !== null} onClick={invite}>
            Invite
          </Button>
        </Stack>
      </Section>

      <Section title={`Accounts · ${accounts.length}`}>
        <Stack gap="sm">
          <TextInput placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          {filtered.length === 0 ? (
            <Empty>No account matches.</Empty>
          ) : (
            <RowList>
              {filtered.map((a) => (
                <ButtonRow
                  key={a.uid}
                  onClick={() => open(a)}
                  avatar={{ name: a.displayName ?? a.email ?? "?", photoUrl: a.photoUrl }}
                  title={a.displayName ?? a.email ?? a.uid}
                  subtitle={`${a.email ?? ""}${a.email ? " · " : ""}${accessSummary(a)}`}
                  meta={
                    a.disabled ? (
                      <Badge color="red" variant="light">
                        Blocked
                      </Badge>
                    ) : a.providers.length === 0 ? (
                      <Badge color="gray" variant="light">
                        Invited
                      </Badge>
                    ) : undefined
                  }
                />
              ))}
            </RowList>
          )}
        </Stack>
      </Section>

      <ResponsiveDialog opened={selected !== null} onClose={() => setSelected(null)} title={selected?.email ?? selected?.displayName ?? "Account"}>
        {selected && (
          <Stack>
            <Text size="sm" c="dimmed">
              {selected.lastSignInDateISOString
                ? `Last sign-in ${formatDateTime(selected.lastSignInDateISOString)}`
                : "Never signed in (invited)"}
              {selected.founderOf.length > 0 ? ` · Founder in ${selected.founderOf.map((m) => m.batchId).join(", ")}` : ""}
            </Text>
            <AccessEditor value={draft} onChange={setDraft} />
            {isSelf && (
              <Text size="xs" c="dimmed">
                This is your account: you cannot remove your own staff access or block yourself.
              </Text>
            )}
            <Button
              size="md"
              fullWidth
              loading={busy === "save"}
              disabled={busy !== null}
              onClick={async () => {
                const ok = await run("save", () => call("setAccountAccess")({ uid: selected.uid, ...draft }), "Access updated.");
                if (ok) setSelected(null);
              }}
            >
              Save access
            </Button>
            <Group grow>
              <Button
                variant="default"
                loading={busy === "remove"}
                disabled={busy !== null || selected.roles.length === 0}
                onClick={async () => {
                  const ok = await run("remove", () => call("setAccountAccess")({ uid: selected.uid, ...NO_ACCESS }), "All roles removed.");
                  if (ok) setSelected(null);
                }}
              >
                Remove all roles
              </Button>
              <Button
                color={selected.disabled ? undefined : "red"}
                variant={selected.disabled ? "default" : "light"}
                loading={busy === "block"}
                disabled={busy !== null || (isSelf && !selected.disabled)}
                onClick={async () => {
                  const disabled = !selected.disabled;
                  const ok = await run(
                    "block",
                    () => call("setAccountDisabled")({ uid: selected.uid, disabled }),
                    disabled ? "Sign-in blocked." : "Sign-in allowed again.",
                  );
                  if (ok) setSelected(null);
                }}
              >
                {selected.disabled ? "Allow sign-in" : "Block sign-in"}
              </Button>
            </Group>
          </Stack>
        )}
      </ResponsiveDialog>
    </>
  );
}
