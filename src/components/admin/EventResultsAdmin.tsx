"use client";

import { useState } from "react";
import { Button, CopyButton, MultiSelect, SegmentedControl, Select, Stack, Text, TextInput } from "@mantine/core";
import { JUDGE_LIMITS, PICKS_LIMITS } from "@shared/callables";
import { defaultPicksQuestion } from "@shared/presets/eventTemplates";
import { EVENT_KIND_FEATURES, PICKS_MAX, isPickable, judgeLinkState, juryTarget, openPicks } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { useAction } from "@/hooks/useAction";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { call } from "@/lib/firebase";
import { queries } from "@/lib/firestore/refs";
import { formatDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { paths } from "@/lib/paths";
import { mutualPairs } from "@/lib/picks";
import { Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Admin d'un evenement : apres les equipes, ce qui fait son resultat
// ----------------------------
// Monte sous le generateur (admin/challenge-teams/[eventId] et
// admin/lunch-roulette/[eventId]) ; chaque bloc suit la mecanique. Tout
// passe par des callables (journalisees) : le serveur recalcule le leaderboard
// et lui seul connait le secret d'un lien de jure, rendu une fois a la creation.

const JURY = "__jury__";

export function EventResultsAdmin() {
  const { event } = useAdminEvent();
  return (
    <>
      {EVENT_KIND_FEATURES[event.kind].leaderboard && <RankingSection />}
      {juryTarget(event.kind) &&
        (event.criteria.length > 0 ? (
          <JurySection />
        ) : (
          <Section title="Jury">
            <Empty>This event has no scoring grid, so there is nothing for a jury to score.</Empty>
          </Section>
        ))}
      <PicksSection />
    </>
  );
}

/** Ce qui classe le leaderboard : les notes du jury, ou une metrique de l'evenement. */
function RankingSection() {
  const { event } = useAdminEvent();
  const { isBusy, run } = useAction();
  const value = event.rankingMetricKey ?? JURY;

  const change = (next: string | null) => {
    if (!next || next === value) return;
    void run(() => call("setEventRanking")({ eventId: event.id, metricKey: next === JURY ? null : next }), "Leaderboard updated");
  };

  const options = [{ value: JURY, label: "Jury scores" }, ...event.metrics.map((m) => ({ value: m.key, label: m.label }))];
  return (
    <Section title="Leaderboard" hint="What ranks the teams. A number comes from the results each team enters in its debrief.">
      {options.length <= 3 ? (
        <SegmentedControl fullWidth maw={480} data={options} value={value} onChange={change} disabled={isBusy} />
      ) : (
        <Select maw={480} data={options} value={value} onChange={change} disabled={isBusy} allowDeselect={false} />
      )}
    </Section>
  );
}

/** Les jures de l'evenement : un lien prive chacun, sans compte. */
function JurySection() {
  const { event, teams } = useAdminEvent();
  const judges = useQueryListener(queries.judgesOfEvent(event.id));
  const { isBusy, run } = useAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  /** Le lien du dernier jure cree : son secret n'est plus jamais relisible ensuite. */
  const [created, setCreated] = useState<{ name: string; url: string } | null>(null);

  const create = async () => {
    const res = await run(
      () => call("createJudge")({ eventId: event.id, name, email: email.trim() || null, excludedTargetIds: excluded }),
      `Link ready for ${name}`,
    );
    if (!res) return;
    setCreated({ name, url: `${window.location.origin}${paths.judge(event.id, res.data.judgeId)}#${res.data.key}` });
    setName("");
    setEmail("");
    setExcluded([]);
  };

  const now = new Date().toISOString();
  return (
    <Section title={`Jury · ${judges.data.length}`} hint="One private link per judge, no account needed. It stops working the day after the event, or when you revoke it.">
      <Stack gap="sm" maw={480}>
        <TextInput label="Judge's name" maxLength={JUDGE_LIMITS.name} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label="Email" description="Optional, for your records." type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <MultiSelect
          label="Teams this judge cannot score"
          description="Their own team, for instance."
          data={teams.filter((t) => t.publishedDateISOString !== null).map((t) => ({ value: t.id, label: t.name }))}
          value={excluded}
          onChange={setExcluded}
          searchable
        />
        <Button size="md" fullWidth loading={isBusy} disabled={!name.trim()} onClick={create}>
          Create the link
        </Button>
        {created && (
          <Stack gap={6}>
            <Text size="sm">Link for {created.name}. Copy it now: it cannot be shown again.</Text>
            <Text size="sm" c="dimmed" style={{ overflowWrap: "anywhere" }}>
              {created.url}
            </Text>
            <CopyButton value={created.url}>
              {({ copied, copy }) => (
                <Button variant="default" w="fit-content" onClick={copy}>
                  {copied ? "Copied" : "Copy the link"}
                </Button>
              )}
            </CopyButton>
          </Stack>
        )}
      </Stack>
      {judges.data.length > 0 && (
        <RowList>
          {[...judges.data]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((j) => {
              const state = judgeLinkState(j, now);
              return (
                <Row
                  key={j.id}
                  title={j.name}
                  subtitle={state === "active" ? `Until ${formatDateTime(j.expiresDateISOString)}` : state === "revoked" ? "Revoked" : "Expired"}
                  meta={
                    state === "active" ? (
                      <Button
                        variant="subtle"
                        color="gray"
                        disabled={isBusy}
                        onClick={() => void run(() => call("revokeJudge")({ eventId: event.id, judgeId: j.id }), `${j.name}'s link revoked`)}
                      >
                        Revoke
                      </Button>
                    ) : undefined
                  }
                />
              );
            })}
        </RowList>
      )}
    </Section>
  );
}

/**
 * Les choix prives de l'evenement : les mutual picks (hackathon de 3 jours),
 * le « qui t'a marque » d'un speed dating. Le staff ouvre, ferme, et voit les
 * choix reciproques, a apparier en premier.
 */
function PicksSection() {
  const { event } = useAdminEvent();
  const { batch, founders, foundersById } = useAdmin();
  const picks = useQueryListener(queries.picksOfEvent(event.id));
  const { isBusy, run } = useAction();
  const current = event.picks;
  const [question, setQuestion] = useState(current?.question ?? defaultPicksQuestion(event.kind));
  const [max, setMax] = useState(String(current?.max ?? 3));
  // Vide : ouvert jusqu'a la fermeture par le staff.
  const [closes, setCloses] = useState(toLocalInput(current?.closesDateISOString ?? null));
  const isOpen = openPicks(event, new Date().toISOString()) !== null;

  const save = (open: boolean) =>
    void run(
      () =>
        call("setEventPicks")({
          eventId: event.id,
          picks: open ? { question, max: Number(max), closesDateISOString: fromLocalInput(closes) } : null,
        }),
      open ? "Picks open" : "Picks closed",
    );

  const mutual = mutualPairs(picks.data);
  const nameOf = (id: string) => foundersById.get(id)?.name ?? id;
  const pickable = founders.filter((f) => isPickable(f, batch.id)).length;

  return (
    <Section
      title="Picks"
      hint="Private choices, ranked. Founders find them in their To do while they are open; only the staff sees them."
      right={<Text size="sm" c={isOpen ? "pioneers" : "dimmed"}>{isOpen ? "Open" : "Closed"}</Text>}
    >
      <Stack gap="sm" maw={480}>
        <TextInput label="Question" maxLength={PICKS_LIMITS.question} value={question} onChange={(e) => setQuestion(e.currentTarget.value)} />
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Picks per founder
          </Text>
          <SegmentedControl fullWidth data={Array.from({ length: PICKS_MAX }, (_, i) => String(i + 1))} value={max} onChange={setMax} />
        </Stack>
        <TextInput
          label="Closes"
          description="Empty: open until you close it."
          type="datetime-local"
          value={closes}
          onChange={(e) => setCloses(e.currentTarget.value)}
        />
        <Button size="md" fullWidth loading={isBusy} disabled={!question.trim()} onClick={() => save(true)}>
          {current ? "Save and keep open" : "Open the picks"}
        </Button>
        {current && (
          <Button variant="default" fullWidth disabled={isBusy} onClick={() => save(false)}>
            Close the picks
          </Button>
        )}
      </Stack>
      <Text size="sm" c="dimmed">
        {picks.data.length} of {pickable} founders picked · {mutual.length} mutual {mutual.length === 1 ? "pair" : "pairs"}
      </Text>
      {mutual.length > 0 && (
        <RowList>
          {mutual.map((m) => (
            <Row key={`${m.a}_${m.b}`} title={`${nameOf(m.a)} and ${nameOf(m.b)}`} subtitle={`Ranked each other ${m.rankA} and ${m.rankB}`} />
          ))}
        </RowList>
      )}
    </Section>
  );
}
