"use client";

import { useBatch } from "@/context/BatchContext";
import { useFounder } from "@/context/FounderContext";
import { useFounders } from "@/context/FoundersContext";
import { useMyConnections } from "@/context/MyConnectionsContext";
import { useProgram } from "@/context/ProgramContext";
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
 */
export function FounderConnections() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founders } = useFounders();
  const { connections, isSelf } = useFounder();
  const mine = useMyConnections();
  const ids = isSelf
    ? mine.isLoading
      ? null
      : { shortlisted: mine.shortlisted, met: mine.met }
    : connections && { shortlisted: new Set(connections.shortlistedFounderIds), met: new Set(connections.metFounderIds) };
  if (!ids) return null;

  const lists = [
    {
      title: "Shortlist",
      ids: ids.shortlisted,
      empty: "No one shortlisted yet.",
      hint: isSelf ? "Visible to you, the Pioneers team and the investment committee." : undefined,
    },
    { title: "Met", ids: ids.met, empty: "No one marked as met yet.", hint: undefined },
  ];

  return lists.map(({ title, ids, empty, hint }) => {
    const people = founders.filter((f) => ids.has(f.id));
    return (
      <Section key={title} title={`${title} · ${people.length}`} hint={hint}>
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
              />
            ))}
          </RowList>
        )}
      </Section>
    );
  });
}
