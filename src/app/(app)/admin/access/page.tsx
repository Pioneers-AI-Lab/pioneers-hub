"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Anchor, Badge, Button, Checkbox, CopyButton, Group, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { AccountAccess, AccountRow } from "@shared/callables";
import type { InvestorAccess, UserRole } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useAction } from "@/hooks/useAction";
import { useCallable } from "@/hooks/useCallable";
import { errorMessage } from "@/lib/errors";
import { call } from "@/lib/firebase";
import { paths } from "@/lib/paths";
import { ActionBar } from "@/components/admin/ActionBar";
import { isInvited, signInSummary } from "@/components/admin/accountLabels";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Admin > Access : tous les comptes, leurs droits, invitation et blocage
// ----------------------------
// Les droits s'ecrivent cote serveur (callables `listAccounts`, `inviteAccount`,
// `setAccountAccess`, `setAccountDisabled`, `createSetPasswordLink`) : chaque
// changement est journalise dans `auditLogs`. Le role fondateur ne se donne pas
// ici : il vient du rattachement a un profil (Admin > Founder profiles).
// Un compte invite n'a aucun fournisseur de connexion : il entre par Google sur
// le meme email, ou choisit un mot de passe par le lien que le staff lui transmet.

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

/**
 * Lien « choisir mon mot de passe » d'un compte jamais connecte, que le staff
 * transmet lui-meme. Copie directe quand le navigateur l'accepte (Safari la
 * refuse apres un appel reseau) ; le lien reste affiche avec son bouton Copy.
 */
function SetPasswordLink({ uid }: { uid: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const { data } = await call("createSetPasswordLink")({ uid });
      setLink(data.link);
      const copied = await navigator.clipboard.writeText(data.link).then(
        () => true,
        () => false,
      );
      notifications.show({ message: copied ? "Set-password link copied." : "Set-password link ready: copy it below." });
    } catch (err) {
      notifications.show({ color: "red", message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={6}>
      {link ? (
        <Group gap="xs" wrap="nowrap">
          <TextInput readOnly aria-label="Set-password link" value={link} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0 }} />
          <CopyButton value={link}>
            {({ copied, copy }) => (
              <Button variant="default" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </CopyButton>
        </Group>
      ) : (
        <Button variant="default" fullWidth loading={isBusy} onClick={create}>
          Copy set-password link
        </Button>
      )}
      <Text size="xs" c="dimmed">
        Send it to the person: they choose a password, then sign in. It works once, for one hour. Continue with Google on
        the same email works too.
      </Text>
    </Stack>
  );
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
  const [isInviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  // Aucun role coche par defaut : le staff choisit (investor : portfolio par defaut).
  const [inviteAccess, setInviteAccess] = useState<AccountAccess>(NO_ACCESS);
  // Le compte cree par la derniere invitation : son lien de mot de passe s'offre tout de suite.
  const [invited, setInvited] = useState<{ email: string; uid: string; created: boolean } | null>(null);
  // Action sensible en attente de confirmation, dans la fenetre du compte.
  const [confirming, setConfirming] = useState<"remove" | "block" | null>(null);
  // `busy` : le bouton qui tourne, celui de la derniere action lancee.
  const { busy, run: runAction } = useAction();
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!accounts || !q) return accounts ?? [];
    return accounts.filter((a) => `${a.email ?? ""} ${a.displayName ?? ""}`.toLowerCase().includes(q));
  }, [accounts, search]);

  const run = async <T,>(label: string, action: () => Promise<T>, success: string) => {
    const result = await runAction(action, success, label);
    if (result !== undefined) reload();
    return result;
  };

  const open = (account: AccountRow) => {
    setSelected(account);
    setConfirming(null);
    setDraft({ roles: account.roles, investorAccess: account.investorAccess });
  };

  const openInvite = () => {
    setInvited(null);
    setInviteEmail("");
    setInviteAccess(NO_ACCESS);
    setInviting(true);
  };

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    const result = await run("invite", () => call("inviteAccount")({ email, ...inviteAccess }), `${email} is invited.`);
    if (result) setInvited({ email, ...result.data });
  };

  const removeAllRoles = async () => {
    if (!selected) return;
    const ok = await run("remove", () => call("setAccountAccess")({ uid: selected.uid, ...NO_ACCESS }), "All roles removed.");
    if (ok) setSelected(null);
  };

  const toggleBlocked = async () => {
    if (!selected) return;
    const disabled = !selected.disabled;
    const ok = await run(
      "block",
      () => call("setAccountDisabled")({ uid: selected.uid, disabled }),
      disabled ? "Sign-in blocked." : "Sign-in allowed again.",
    );
    if (ok) setSelected(null);
  };

  if (isLoading) return <PageLoader />;
  if (!accounts) return <Empty>{error}</Empty>;
  const isSelf = selected?.uid === viewer?.uid;
  // L'etape de confirmation d'une action sensible, dans la fenetre du compte.
  const confirm = confirming
    ? {
        remove: {
          title: "Remove all roles?",
          body: "keeps its account but loses its staff, investor and mentor access. Founder access through a profile is kept.",
          label: "Remove all roles",
          action: removeAllRoles,
        },
        block: {
          title: "Block sign-in?",
          body: "can no longer sign in, and open sessions end within the hour. You can allow sign-in again later.",
          label: "Block sign-in",
          action: toggleBlocked,
        },
      }[confirming]
    : null;

  return (
    <>
      <PageHeader
        back={{ href: paths.admin(), label: "Admin" }}
        title="Access"
        subtitle="Every account and its access. Each change is logged."
      />

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
                    ) : isInvited(a) ? (
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

      <ActionBar label="Invite" onClick={openInvite} />

      <ResponsiveDialog opened={isInviting} onClose={() => setInviting(false)} title={invited ? "Invited" : "Invite"}>
        {invited ? (
          <Stack>
            <Text size="sm">
              {invited.created
                ? `${invited.email} has an account with these roles. They sign in with Google on this email, or choose a password with this link.`
                : `${invited.email} already had an account: its roles are updated.`}
            </Text>
            {invited.created && <SetPasswordLink uid={invited.uid} />}
            <Button size="md" fullWidth onClick={() => setInviting(false)}>
              Done
            </Button>
          </Stack>
        ) : (
          <Stack>
            <Text size="sm" c="dimmed">
              The account is ready before the first sign-in: the person signs in with Google on this exact email (or chooses a password with the link offered next) and already has these roles.
            </Text>
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
        )}
      </ResponsiveDialog>

      <ResponsiveDialog
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title={confirm ? confirm.title : (selected?.email ?? selected?.displayName ?? "Account")}
      >
        {selected && confirm && (
          <Stack>
            <Text size="sm">
              {selected.email ?? "This account"} {confirm.body}
            </Text>
            <Group grow>
              <Button variant="default" size="md" disabled={busy !== null} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                color="red"
                size="md"
                loading={busy === confirming}
                disabled={busy !== null}
                onClick={confirm.action}
              >
                {confirm.label}
              </Button>
            </Group>
          </Stack>
        )}
        {selected && !confirm && (
          <Stack>
            <Text size="sm" c="dimmed">
              {signInSummary(selected)}
              {selected.founderOf.length > 0 ? ` · Founder in ${selected.founderOf.map((m) => m.batchId).join(", ")}` : ""}
            </Text>
            {selected.founderOf.length > 0 && (
              <Anchor component={Link} href={paths.adminProfiles()} size="sm" className="tap-link">
                Unlink a founder profile: Founder profiles
              </Anchor>
            )}
            {selected.lastSignInDateISOString === null && !selected.disabled && <SetPasswordLink key={selected.uid} uid={selected.uid} />}
            <AccessEditor value={draft} onChange={setDraft} />
            {isSelf && (
              <Text size="xs" c="dimmed">
                This is your account: you cannot remove your own roles or block yourself.
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
                disabled={busy !== null || isSelf || selected.roles.length === 0}
                onClick={() => setConfirming("remove")}
              >
                Remove all roles
              </Button>
              <Button
                color={selected.disabled ? undefined : "red"}
                variant={selected.disabled ? "default" : "light"}
                loading={busy === "block"}
                disabled={busy !== null || (isSelf && !selected.disabled)}
                onClick={selected.disabled ? toggleBlocked : () => setConfirming("block")}
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
