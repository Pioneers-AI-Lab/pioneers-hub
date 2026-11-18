"use client";

import { COMING_UP_DAYS } from "@shared/tasks";
import { useTodoItems } from "@/hooks/useTodoItems";
import { ComingUpRow, TodoRow } from "@/components/todo/TodoRows";
import { PageLoader } from "@/components/ui/PageLoader";
import { RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// « To do » (SPECS §3.1, decision du 18/11) : des TACHES seulement, jamais un
// evenement (le Calendar les montre). Ce qui est ouvert, par echeance (profil,
// taches du batch, formulaires : `useTodoItems`, aussi resume en haut de « Me »),
// puis ce qui ouvre dans les 7 jours.
export default function TodoPage() {
  const { toDo, comingUp, isLoading } = useTodoItems();

  if (isLoading) return <PageLoader />;

  return (
    <>
      <Section title="To do" help="Open now, the nearest deadline first. Tick a task once you have done it; the app checks the others itself.">
        {toDo.every((i) => i.done) && <Empty>You are all set.</Empty>}
        <RowList>
          {toDo.map((i) => (
            <TodoRow key={i.id} item={i} />
          ))}
        </RowList>
      </Section>

      {comingUp.length > 0 && (
        <Section title="Coming up" help={`What opens in the next ${COMING_UP_DAYS} days.`}>
          <RowList>
            {comingUp.map((i) => (
              <ComingUpRow key={i.id} item={i} />
            ))}
          </RowList>
        </Section>
      )}
    </>
  );
}
