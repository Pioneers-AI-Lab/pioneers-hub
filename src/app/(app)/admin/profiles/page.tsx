"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Anchor, Badge, Box, Button, Group, Select, Stack, Text, TextInput, type ComboboxItem, type OptionsFilter } from "@mantine/core";
import type { Founder, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAction } from "@/hooks/useAction";
import { useCallable } from "@/hooks/useCallable";
import { linkFounder, setFounderArchived, unlinkFounder } from "@/lib/accounts";
import { formatDay, searchKey } from "@/lib/format";
import { paths } from "@/lib/paths";
import { accountLabel, signInSummary } from "@/components/admin/accountLabels";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { PageHeader } from "@/components/ui/PageHeader";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { WithHelp } from "@/components/ui/Help";

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

// Comptes du champ « Account » : la meme recherche sans accents ni casse que la liste.
const accountFilter: OptionsFilter = ({ options, search }) => {
  const q = searchKey(search);
  return (options as ComboboxItem[]).filter((o) => searchKey(o.label).includes(q));
};

const byClaimDateDesc = (a: WithId<Founder>, b: WithId<Founder>) =>
  (b.claimedDateISOString ?? "").localeCompare(a.claimedDateISOString ?? "");

export default function AdminProfilesPage() {
  const { batch, founders, archivedFounders } = useAdmin();
  const { data } = useCallable("listAccounts", {});
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WithId<Founder> | null>(null);
  const [confirming, setConfirming] = useState<"unlink" | "archive" | null>(null);
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
    setConfirming(null);
    setAccountUid(null);
  };

  /** Une ecriture puis, si elle passe, la fenetre se ferme. */
  const runAndClose = async (action: () => Promise<void>, success: string, key: string) => {
    if ((await run(async () => (await action(), true), success, key)) === true) setSelected(null);
  };

  const link = (f: WithId<Founder>) => {
    const account = accountUid ? accountByUid.get(accountUid) : undefined;
    if (account) return runAndClose(() => linkFounder(f, account), `${f.name} is linked to ${account.email ?? "the account"}.`, "link");
  };

  const selectedAccount = selected ? accountOf(selected) : undefined;
  // L'etape de confirmation d'une action sensible, dans la fenetre du profil.
  const confirm =
    selected && confirming
      ? {
          unlink: {
            title: "Unlink this account?",
            body: `${selectedAccount?.email ?? "The account"} loses access to ${batch.name} as ${selected.name}. The profile is kept and can be linked again.`,
            label: "Unlink",
            action: () => runAndClose(() => unlinkFounder(selected), "Account unlinked.", "unlink"),
          },
          archive: {
            title: "Archive this profile?",
            body: `${selected.name} leaves the lists, draws and forms of ${batch.name}, and the list where founders find their profile. Nothing is deleted: restore it below, under Archived.`,
            label: "Archive",
            action: () =>
              runAndClose(() => setFounderArchived(selected.id, true), `${selected.name} is archived.`, "archive"),
          },
        }[confirming]
      : null;

  return (
    <>
      <PageHeader
        back={{ href: paths.admin(), label: "Admin" }}
        title="Founder profiles"
        help="The account linked to each founder profile. Founders link their own at sign-in; fix a mistake here."
      />
      <BatchPicker />

      <TextInput placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />

      <Section title={`Linked · ${linked.length}`} help="Most recent first.">
        {linked.length === 0 ? (
          <Empty>{q ? "No linked profile matches." : `No account linked in ${batch.name} yet.`}</Empty>
        ) : (
          <RowList>
            {linked.map((f) => (
              <ButtonRow opens
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

      <Section title={`Not linked · ${notLinked.length}`} help="They link themselves at sign-in: by email, or by picking their name.">
        {notLinked.length === 0 ? (
          <Empty>{q ? "No profile matches." : "Every profile is linked."}</Empty>
        ) : (
          <RowList>
            {notLinked.map((f) => (
              <ButtonRow opens key={f.id} onClick={() => open(f)} avatar={{ name: f.name, photoUrl: f.photoUrl }} title={f.name} subtitle="Not linked" />
            ))}
          </RowList>
        )}
      </Section>

      {archivedFounders.length > 0 && (
        <Section title={`Archived · ${archivedFounders.length}`} help="Out of the lists, draws and forms. Restore a profile archived by mistake.">
          <RowList>
            {archivedFounders.map((f) => (
              <ButtonRow
                key={f.id}
                onClick={() => void run(() => setFounderArchived(f.id, false), `${f.name} is restored.`, `restore-${f.id}`)}
                avatar={{ name: f.name, photoUrl: f.photoUrl }}
                title={f.name}
                subtitle={`Archived ${formatDay(f.archivedDateISOString?.slice(0, 10))}`}
                meta={busy === `restore-${f.id}` ? "Restoring…" : "Restore"}
              />
            ))}
          </RowList>
        </Section>
      )}

      <ResponsiveDialog
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title={confirm?.title ?? selected?.name ?? "Profile"}
      >
        {confirm && (
          <Stack>
            <Text size="sm">{confirm.body}</Text>
            <Group grow>
              <Button variant="default" size="md" disabled={busy !== null} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button color="red" size="md" loading={busy === confirming} disabled={busy !== null} onClick={confirm.action}>
                {confirm.label}
              </Button>
            </Group>
          </Stack>
        )}
        {selected && !confirm && (
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
                <Button color="red" variant="light" size="md" fullWidth disabled={busy !== null} onClick={() => setConfirming("unlink")}>
                  Unlink
                </Button>
                <Text size="xs" c="dimmed">
                  To archive this profile (a duplicate, a mistake), unlink the account first.
                </Text>
              </>
            ) : (
              <>
                <WithHelp label="Account" help="Accounts without a profile in this batch. To add someone new, invite them in Admin > Access first.">
                  {(field) => (
                    <Select
                      {...field}
                      placeholder={data ? "Search by name or email" : "Loading accounts…"}
                      searchable
                      data={linkable}
                      value={accountUid}
                      onChange={setAccountUid}
                      filter={accountFilter}
                      nothingFoundMessage="No account matches."
                      comboboxProps={{ withinPortal: true }}
                    />
                  )}
                </WithHelp>
                <Button size="md" fullWidth loading={busy === "link"} disabled={!accountUid || busy !== null} onClick={() => link(selected)}>
                  Link
                </Button>
                <Button color="red" variant="subtle" size="md" fullWidth disabled={busy !== null} onClick={() => setConfirming("archive")}>
                  Archive this profile
                </Button>
              </>
            )}
          </Stack>
        )}
      </ResponsiveDialog>
    </>
  );
}
