"use client";

import Link from "next/link";
import { Button, Text } from "@mantine/core";
import dayjs from "dayjs";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { useFounder } from "@/context/FounderContext";
import { useProgram } from "@/context/ProgramContext";
import { useTodoItems } from "@/hooks/useTodoItems";
import { missingProfileFields } from "@/lib/completeness";
import { joinList } from "@/lib/format";
import { paths } from "@/lib/paths";
import { EventRow } from "@/components/event/EventRow";
import { FormRow } from "@/components/todo/TodoRows";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// « A faire » (SPECS §3.1) : ce qui manque a mon profil, les formulaires
// qu'il me reste a remplir et leur echeance, dont les picks et le Debrief des
// hackathons (`useTodoItems`, aussi resume en haut de « Me »), ce qui arrive
// cette semaine.
export default function TodoPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founder, directory, profile, isDetailsLoading } = useFounder();
  const { events } = useEvents();
  const { forms, picks, debriefs, isLoading } = useTodoItems();

  if (isDetailsLoading || isLoading) return <PageLoader />;

  const missing = missingProfileFields(founder, directory, profile);
  const required = missing.filter((m) => m.required);
  const useful = missing.filter((m) => !m.required);
  const labels = (fields: typeof missing) => joinList(fields.map((m) => m.label));
  const now = dayjs();
  const thisWeek = events.filter((e) => {
    const start = dayjs(e.startDateISOString);
    return start.isAfter(now.subtract(2, "hour")) && start.isBefore(now.add(7, "day"));
  });
  const nothing =
    missing.length === 0 && forms.length === 0 && thisWeek.length === 0 && debriefs.every((d) => d.done) && picks.every((p) => p.done);

  return (
    <>
      <PageHeader title="To do" />
      {nothing && <Empty>You are all set. New forms and events show up here.</Empty>}

      {missing.length > 0 && (
        <Section
          title="Your profile"
          hint={
            required.length > 0
              ? `${required.length} required ${required.length === 1 ? "field is" : "fields are"} empty. Other founders look for co-founders with these.`
              : "A few useful fields are still empty."
          }
        >
          {/* Les obligatoires (ceux que compte la phrase) d'abord, puis les utiles, chacun nomme. */}
          {required.length > 0 && <Text size="sm">Required: {labels(required)}</Text>}
          {useful.length > 0 && (
            <Text size="sm" c={required.length > 0 ? "dimmed" : undefined}>
              {required.length > 0 ? `Also useful (${useful.length}): ` : ""}
              {labels(useful)}
            </Text>
          )}
          <Button component={Link} href={paths.founderEdit(program.id, batch.id, founder.id)} size="md" mt="xs" fullWidth maw={400}>
            Complete my profile
          </Button>
        </Section>
      )}

      {forms.length > 0 && (
        <Section title="Forms">
          <RowList>
            {forms.map((f) => (
              <FormRow key={f.form.id} item={f} />
            ))}
          </RowList>
        </Section>
      )}

      {picks.length > 0 && (
        <Section title="Picks" hint="Private: only the Pioneers team sees your choices.">
          <RowList>
            {picks.map((p) => (
              <FormRow key={p.form.id} item={p} />
            ))}
          </RowList>
        </Section>
      )}

      {debriefs.length > 0 && (
        <Section title="Hackathons" hint="Your team's results and a word on each teammate, after every hackathon.">
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
