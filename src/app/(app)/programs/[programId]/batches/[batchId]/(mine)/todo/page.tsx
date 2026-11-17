"use client";

import dayjs from "dayjs";
import { useEvents } from "@/context/EventsContext";
import { useTodoItems } from "@/hooks/useTodoItems";
import { EventRow } from "@/components/event/EventRow";
import { ChecklistRow, FormRow } from "@/components/todo/TodoRows";
import { PageLoader } from "@/components/ui/PageLoader";
import { RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// « A faire » (SPECS §3.1) : la checklist (mon profil, puis les taches du
// batch que je coche moi-meme), les formulaires qu'il me reste a remplir et
// leur echeance, dont la Submission et le Peer rating des hackathons (`useTodoItems`,
// aussi resume en haut de « Me »), ce qui arrive cette semaine.
export default function TodoPage() {
  const { events } = useEvents();
  const { forms, debriefs, checklist, isLoading } = useTodoItems();

  if (isLoading) return <PageLoader />;

  const now = dayjs();
  const thisWeek = events.filter((e) => {
    const start = dayjs(e.startDateISOString);
    return start.isAfter(now.subtract(2, "hour")) && start.isBefore(now.add(7, "day"));
  });
  const nothing =
    checklist.every((c) => c.done) && forms.length === 0 && thisWeek.length === 0 && debriefs.every((d) => d.done);

  return (
    <>
      {nothing && <Empty>You are all set. New forms and events show up here.</Empty>}

      <Section title="Checklist" help="Tick a task once you have done it.">
        <RowList>
          {checklist.map((c) => (
            <ChecklistRow key={c.id} item={c} />
          ))}
        </RowList>
      </Section>

      {forms.length > 0 && (
        <Section title="Forms">
          <RowList>
            {forms.map((f) => (
              <FormRow key={f.form.id} item={f} />
            ))}
          </RowList>
        </Section>
      )}

      {debriefs.length > 0 && (
        <Section title="Hackathons" help="Your team's submission before the deadline, then a word on each teammate at the debrief.">
          <RowList>
            {debriefs.map((d) => (
              <FormRow key={d.form.id} item={d} />
            ))}
          </RowList>
        </Section>
      )}

      {thisWeek.length > 0 && (
        <Section title="This week">
          <RowList>
            {thisWeek.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </RowList>
        </Section>
      )}
    </>
  );
}
