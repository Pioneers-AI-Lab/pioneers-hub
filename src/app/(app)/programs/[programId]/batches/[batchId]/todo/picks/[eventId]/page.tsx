"use client";

import { useState } from "react";
import { Button, Group, Select, Stack } from "@mantine/core";
import { isPickable, openPicks, type EventPicks } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { useFounder } from "@/context/FounderContext";
import { useFounders } from "@/context/FoundersContext";
import { useMyPicks } from "@/context/MyPicksContext";
import { useProgram } from "@/context/ProgramContext";
import { useAction } from "@/hooks/useAction";
import { useParamsTS } from "@/hooks/useParamsTS";
import { call } from "@/lib/firebase";
import { paths } from "@/lib/paths";
import { picksSubtitle } from "@/lib/picks";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { RankNumber, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Mes choix pour un evenement (mutual picks, « qui t'a marque »), classes
// ----------------------------
// Prives : seuls le staff et le fondateur les lisent. Rejouables tant que la
// demande est ouverte ; le dernier enregistrement remplace le precedent.

export default function PicksPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { eventId } = useParamsTS<{ eventId: string }>();
  const { events, isLoading } = useEvents();
  const { picksByEventId } = useMyPicks();
  const back = { href: paths.todo(program.id, batch.id), label: "To do" };

  if (isLoading) return <PageLoader />;
  const event = events.find((e) => e.id === eventId);
  const picks = event ? openPicks(event, new Date().toISOString()) : null;
  if (!event || !picks) {
    return (
      <>
        <PageHeader back={back} title="Picks" />
        <Empty>These picks are closed.</Empty>
      </>
    );
  }
  const given = picksByEventId.get(event.id)?.pickedFounderIds ?? [];
  return (
    <>
      <PageHeader
        back={back}
        title={picks.question}
        subtitle={picksSubtitle(event.name, picks)}
      />
      <PicksForm key={given.join()} eventId={event.id} picks={picks} initial={given} />
    </>
  );
}

function PicksForm({ eventId, picks, initial }: { eventId: string; picks: EventPicks; initial: string[] }) {
  const { founder } = useFounder();
  const { founders, foundersById } = useFounders();
  const [picked, setPicked] = useState<string[]>(initial);
  const { isBusy, run } = useAction();
  const options = founders
    .filter((f) => f.id !== founder.id && isPickable(f, founder.batchId) && !picked.includes(f.id))
    .map((f) => ({ value: f.id, label: f.name }));

  /** Remonte le choix `i` d'un rang. */
  const moveUp = (i: number) =>
    setPicked((p) => {
      const next = [...p];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  const save = () => void run(() => call("submitPicks")({ eventId, pickedFounderIds: picked }), "Picks saved");

  return (
    <Section title={`Your picks · ${picked.length} of ${picks.max}`} hint="Your first choice first. Private: only the Pioneers team sees them.">
      <Stack gap="sm">
        {picked.length > 0 && (
          <RowList>
            {picked.map((id, i) => {
              const f = foundersById.get(id);
              const name = f?.name ?? id;
              return (
                <Row
                  key={id}
                  leading={<RankNumber rank={i + 1} highlight />}
                  avatar={{ name, photoUrl: f?.photoUrl }}
                  title={name}
                  meta={
                    <Group gap={4} wrap="nowrap">
                      {i > 0 && (
                        <Button variant="subtle" color="gray" onClick={() => moveUp(i)}>
                          Up
                        </Button>
                      )}
                      <Button variant="subtle" color="gray" onClick={() => setPicked((p) => p.filter((x) => x !== id))}>
                        Remove
                      </Button>
                    </Group>
                  }
                />
              );
            })}
          </RowList>
        )}
        {picked.length < picks.max && (
          <Select
            aria-label="Add a founder"
            placeholder="Add a founder"
            data={options}
            value={null}
            onChange={(id) => id && setPicked((p) => [...p, id])}
            searchable
          />
        )}
        <Button size="md" fullWidth maw={400} mt="xs" loading={isBusy} disabled={picked.length === 0} onClick={save}>
          Save my picks
        </Button>
      </Stack>
    </Section>
  );
}
