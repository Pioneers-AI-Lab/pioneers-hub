"use client";

import Link from "next/link";
import { Button, Stack, Text } from "@mantine/core";
import dayjs from "dayjs";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { useFounder } from "@/context/FounderContext";
import { useOpenForms } from "@/context/OpenFormsContext";
import { useProgram } from "@/context/ProgramContext";
import { missingProfileFields } from "@/lib/completeness";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { EVENT_KIND_LABEL } from "@/components/event/eventLabels";

// « A faire » (SPECS §3.1) : ce qui manque a mon profil, les formulaires
// ouverts et leur echeance, ce qui arrive cette semaine.
export default function TodoPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founder, directory, profile, isDetailsLoading } = useFounder();
  const { forms, isLoading: isFormsLoading } = useOpenForms();
  const { events } = useEvents();

  if (isDetailsLoading || isFormsLoading) return <PageLoader />;

  const missing = missingProfileFields(founder, directory, profile);
  const required = missing.filter((m) => m.required);
  const now = dayjs();
  const thisWeek = events.filter((e) => {
    const start = dayjs(e.startDateISOString);
    return start.isAfter(now.subtract(2, "hour")) && start.isBefore(now.add(7, "day"));
  });
  const nothing = missing.length === 0 && forms.length === 0 && thisWeek.length === 0;

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
          <Text size="sm">{missing.map((m) => m.label).join(", ")}</Text>
          <Button component={Link} href={paths.meEdit(program.id, batch.id)} size="md" mt="xs" fullWidth maw={400}>
            Complete my profile
          </Button>
        </Section>
      )}

      {forms.length > 0 && (
        <Section title="Forms" hint="Open them from the link the team shares on Slack.">
          <RowList>
            {forms.map((f) => (
              <Row
                key={f.id}
                title={f.title}
                subtitle={f.description ?? undefined}
                meta={
                  f.deadlineDateISOString ? (
                    <Text size="sm" c={dayjs(f.deadlineDateISOString).diff(now, "hour") < 24 ? "pioneers" : "dimmed"}>
                      Due {formatDateTime(f.deadlineDateISOString)}
                    </Text>
                  ) : undefined
                }
              />
            ))}
          </RowList>
        </Section>
      )}

      {thisWeek.length > 0 && (
        <Section title="This week">
          <Stack gap={0}>
            <RowList>
              {thisWeek.map((e) => (
                <Row
                  key={e.id}
                  title={e.name}
                  subtitle={[formatDateTime(e.startDateISOString), e.location].filter(Boolean).join(" · ")}
                  meta={EVENT_KIND_LABEL[e.kind]}
                />
              ))}
            </RowList>
          </Stack>
        </Section>
      )}
    </>
  );
}
