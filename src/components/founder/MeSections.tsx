"use client";

import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { useTodoItems } from "@/hooks/useTodoItems";
import { paths } from "@/lib/paths";
import { UpcomingEvents } from "@/components/event/UpcomingEvents";
import { FormRow } from "@/components/todo/TodoRows";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Le haut de « Me » : ce qui m'attend
// ----------------------------
// FounderCard le place sur SA fiche : FormsToFill est monte par
// (mine)/layout.tsx, ou par `SelfProviders` sous /founders/{son id}.

const TODO_LIMIT = 5;

/** Resume de « To do » (seulement ce qui reste a faire), puis le lien vers la page complete. */
function MeTodo() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { forms, picks, debriefs, isLoading } = useTodoItems();

  const rows = [...picks, ...debriefs, ...forms].filter((i) => !i.done).map((i) => <FormRow key={i.form.id} item={i} />);
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

/** To do, puis mes prochains evenements. */
export function MeSections() {
  return (
    <>
      <MeTodo />
      <UpcomingEvents limit={5} />
    </>
  );
}
