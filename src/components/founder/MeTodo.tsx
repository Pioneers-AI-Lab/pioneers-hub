"use client";

import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { useTodoItems } from "@/hooks/useTodoItems";
import { paths } from "@/lib/paths";
import { ChecklistRow, FormRow } from "@/components/todo/TodoRows";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Le haut de « Me » : ce qui me reste a faire
// ----------------------------
// FounderCard le place sur SA fiche : FormsToFill est monte par
// (mine)/layout.tsx, ou par `SelfProviders` sous /founders/{son id}.

const TODO_LIMIT = 5;

/**
 * Resume de « To do » (seulement ce qui reste a faire : formulaires, puis
 * elements de la checklist), puis le lien vers la page complete.
 */
export function MeTodo() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { forms, debriefs, checklist, isLoading } = useTodoItems();

  const rows = [
    ...[...debriefs, ...forms].filter((i) => !i.done).map((i) => <FormRow key={i.form.id} item={i} />),
    ...checklist.filter((c) => !c.done).map((c) => <ChecklistRow key={c.id} item={c} />),
  ];
  if (isLoading) return null;
  const more = rows.length - TODO_LIMIT;

  return (
    <Section title="To do">
      {rows.length === 0 && <Empty>You are all set.</Empty>}
      <RowList>
        {rows.slice(0, TODO_LIMIT)}
        <LinkRow href={paths.todo(program.id, batch.id)} title="All to do" meta={more > 0 ? `${more} more` : undefined} />
      </RowList>
    </Section>
  );
}
