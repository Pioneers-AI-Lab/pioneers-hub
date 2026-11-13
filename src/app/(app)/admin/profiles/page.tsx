"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Anchor, Badge, Box, Button, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import type { Founder, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAction } from "@/hooks/useAction";
import { useCallable } from "@/hooks/useCallable";
import { linkFounder, unlinkFounder } from "@/lib/accounts";
import { formatDay, searchKey } from "@/lib/format";
import { paths } from "@/lib/paths";
import { accountLabel, signInSummary } from "@/components/admin/accountLabels";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { PageHeader } from "@/components/ui/PageHeader";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Admin > Founder profiles : quel compte est rattache a chaque profil du batch
// ----------------------------
// Les COMPTES (roles, invitation, blocage) sont dans Admin > Access ; ici, les
// PROFILS fondateurs du batch choisi. Un profil appartient a un seul batch ; un
// compte a au plus un profil par batch (il peut en avoir dans plusieurs batchs).
// Le fondateur se rattache lui-meme a la connexion (email, ou « c'est moi ») :
// le staff delie une erreur, ou lie a la main si besoin.
// Les profils viennent du batch (temps reel) ; l'email d'un compte vient de
// Firebase Auth (callable `listAccounts`) et complete les lignes a son arrivee.

const byClaimDateDesc = (a: WithId<Founder>, b: WithId<Founder>) =>
  (b.claimedDateISOString ?? "").localeCompare(a.claimedDateISOString ?? "");

export default function AdminProfilesPage() {
  const { batch, founders } = useAdmin();
  const { data } = useCallable("listAccounts", {});
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WithId<Founder> | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [accountUid, setAccountUid] = useState<string | null>(null);
  const { busy, run } = useAction();

  const accountByUid = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.uid, a])), [data]);
  const accountOf = (f: WithId<Founder>) => (f.uid ? accountByUid.get(f.uid) : undefined);

  const q = searchKey(search);
  const matches = (f: WithId<Founder>) => !q || searchKey(`${f.name} ${accountOf(f)?.email ?? ""}`).includes(q);
  const linked = founders.filter((f) => f.uid && matches(f)).sort(byClaimDateDesc);
  const notLinked = founders.filter((f) => !f.uid && matches(f));

  // Comptes qu'on peut lier ici : pas bloques, sans profil dans ce batch (lu sur
  // les profils en temps reel : rien a recharger apres un lien ou un delien).
  const linkedUids = new Set(founders.map((f) => f.uid).filter(Boolean));
  const linkable = [...accountByUid.values()]
    .filter((a) => !a.disabled && !linkedUids.has(a.uid))
    .map((a) => ({ value: a.uid, label: accountLabel(a) }));

  const open = (f: WithId<Founder>) => {
    setSelected(f);
    setConfirmUnlink(false);
    setAccountUid(null);
  };

  const unlink = async (f: WithId<Founder>) => {
    if ((await run(async () => (await unlinkFounder(f), true), "Account unlinked.", "unlink")) === true) setSelected(null);
  };

  const link = async (f: WithId<Founder>) => {
    const account = accountUid ? accountByUid.get(accountUid) : undefined;
    if (!account) return;
    const done = await run(async () => (await linkFounder(f, account), true), `${f.name} is linked to ${account.email ?? "the account"}.`, "link");
    if (done === true) setSelected(null);
  };

  const selectedAccount = selected ? accountOf(selected) : undefined;

  return (
    <>
      <PageHeader
        back={{ href: paths.admin(), label: "Admin" }}
        title="Founder profiles"
        subtitle="The account linked to each founder profile. Founders link their own at sign-in; fix a mistake here."
      />
      <BatchPicker />

      <TextInput placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />

      <Section title={`Linked · ${linked.length}`} hint="Most recent first.">
        {linked.length === 0 ? (
          <Empty>{q ? "No linked profile matches." : `No account linked in ${batch.name} yet.`}</Empty>
        ) : (
          <RowList>
            {linked.map((f) => (
              <ButtonRow
                key={f.id}
                onClick={() => open(f)}
                avatar={{ name: f.name, photoUrl: f.photoUrl }}
                title={f.name}
                subtitle={[accountOf(f)?.email, `Linked ${formatDay(f.claimedDateISOString?.slice(0, 10))}`].filter(Boolean).join(" · ")}
              />
            ))}
          </RowList>
        )}
      </Section>

      <Section title={`Not linked · ${notLinked.length}`} hint="They link themselves at sign-in: by email, or by picking their name.">
        {notLinked.length === 0 ? (
          <Empty>{q ? "No profile matches." : "Every profile is linked."}</Empty>
        ) : (
          <RowList>
            {notLinked.map((f) => (
              <ButtonRow key={f.id} onClick={() => open(f)} avatar={{ name: f.name, photoUrl: f.photoUrl }} title={f.name} subtitle="Not linked" />
            ))}
          </RowList>
        )}
      </Section>

      <ResponsiveDialog
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title={confirmUnlink ? "Unlink this account?" : (selected?.name ?? "Profile")}
      >
        {selected && confirmUnlink && (
          <Stack>
            <Text size="sm">
              {selectedAccount?.email ?? "The account"} loses access to {batch.name} as {selected.name}. The profile is kept and
              can be linked again.
            </Text>
            <Group grow>
              <Button variant="default" size="md" disabled={busy !== null} onClick={() => setConfirmUnlink(false)}>
                Cancel
              </Button>
              <Button color="red" size="md" loading={busy === "unlink"} disabled={busy !== null} onClick={() => unlink(selected)}>
                Unlink
              </Button>
            </Group>
          </Stack>
        )}
        {selected && !confirmUnlink && (
          <Stack>
            <Anchor component={Link} href={paths.founder(selected.programId, selected.batchId, selected.id)} size="sm" className="tap-link">
              Open the profile
            </Anchor>
            {selected.uid ? (
              <>
                <Box>
                  <Group gap="xs">
                    <Text fw={500}>{selectedAccount?.email ?? `Account ${selected.uid.slice(0, 6)}`}</Text>
                    {selectedAccount?.disabled && (
                      <Badge color="red" variant="light">
                        Blocked
                      </Badge>
                    )}
                  </Group>
                  <Text size="sm" c="dimmed">
                    {[`Linked ${formatDay(selected.claimedDateISOString?.slice(0, 10))}`, selectedAccount && signInSummary(selectedAccount)]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </Box>
                <Text size="xs" c="dimmed">
                  Roles and sign-in of this account: Admin &gt; Access.
                </Text>
                <Button color="red" variant="light" size="md" fullWidth disabled={busy !== null} onClick={() => setConfirmUnlink(true)}>
                  Unlink
                </Button>
              </>
            ) : (
              <>
                <Select
                  label="Account"
                  description="Accounts without a profile in this batch. To add someone new, invite them in Admin > Access first."
                  placeholder={data ? "Search by name or email" : "Loading accounts…"}
                  searchable
                  data={linkable}
                  value={accountUid}
                  onChange={setAccountUid}
                  nothingFoundMessage="No account matches."
                  comboboxProps={{ withinPortal: true }}
                />
                <Button size="md" fullWidth loading={busy === "link"} disabled={!accountUid || busy !== null} onClick={() => link(selected)}>
                  Link
                </Button>
              </>
            )}
          </Stack>
        )}
      </ResponsiveDialog>
    </>
  );
}
