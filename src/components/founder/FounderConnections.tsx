"use client";

import Link from "next/link";
import { Button } from "@mantine/core";
import type { FounderConnectionList } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useFounder } from "@/context/FounderContext";
import { useFounders } from "@/context/FoundersContext";
import { useMyConnections } from "@/context/MyConnectionsContext";
import { useProgram } from "@/context/ProgramContext";
import { notifyError } from "@/lib/errors";
import { setFounderConnection } from "@/lib/firestore/write";
import { PROFILE_CATEGORY_LABEL } from "@/lib/format";
import { paths } from "@/lib/paths";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

/**
 * Sections « Shortlist » et « Met » d'une fiche : la shortlist et les rencontres
 * du fondateur affiche, pour lui-meme (MyConnectionsContext, celles que ses
 * boutons ecrivent), le staff et les investors IC (FounderContext ; rien pour
 * les autres : `connections` est nul). Ordre de l'annuaire (par nom) : la
 * shortlist n'est pas classee. Un id hors de l'annuaire (profil archive) est ignore.
 * Sur SA fiche (demande du 16/11) : « Remove » sur chaque ligne et « Manage » vers
 * l'annuaire (sans filtre), ou se cochent les autres. Le staff ne fait que lire.
 */
export function FounderConnections() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founders } = useFounders();
  const { connections, isSelf } = useFounder();
  const mine = useMyConnections();
  const sets = isSelf
    ? !mine.isLoading && mine
    : connections && { shortlisted: new Set(connections.shortlistedFounderIds), met: new Set(connections.metFounderIds) };
  if (!sets) return null;

  const lists: { list: FounderConnectionList; title: string; ids: ReadonlySet<string>; empty: string; hint?: string }[] = [
    {
      list: "shortlistedFounderIds",
      title: "Shortlist",
      ids: sets.shortlisted,
      empty: "No one shortlisted yet.",
      hint: isSelf ? "Visible to you, the Pioneers team and the investment committee." : undefined,
    },
    { list: "metFounderIds", title: "Met", ids: sets.met, empty: "No one marked as met yet." },
  ];
  // Sur SA fiche seulement : lui seul ecrit ses listes (firestore.rules).
  const ownerId = isSelf ? mine.founderId : null;
  const manage = ownerId && (
    <Button component={Link} href={paths.founders(program.id, batch.id)} variant="default" size="sm">
      Manage
    </Button>
  );

  return lists.map(({ list, title, ids, empty, hint }) => {
    const people = founders.filter((f) => ids.has(f.id));
    return (
      <Section key={title} title={`${title} · ${people.length}`} hint={hint} right={manage}>
        {people.length === 0 ? (
          <Empty>{empty}</Empty>
        ) : (
          <RowList>
            {people.map((f) => (
              <LinkRow
                key={f.id}
                href={paths.founder(program.id, batch.id, f.id)}
                avatar={{ name: f.name, photoUrl: f.photoUrl }}
                title={f.name}
                subtitle={f.profileCategory ? PROFILE_CATEGORY_LABEL[f.profileCategory] : undefined}
                action={
                  ownerId ? (
                    <Button variant="default" size="sm" onClick={() => void setFounderConnection(ownerId, list, f.id, false).catch(notifyError)}>
                      Remove
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </RowList>
        )}
      </Section>
    );
  });
}
