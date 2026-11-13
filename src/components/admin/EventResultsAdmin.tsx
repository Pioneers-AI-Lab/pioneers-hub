"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, CopyButton, Group, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { FORM_TEMPLATES, type FormTemplateKey } from "@shared/presets/formTemplates";
import { formState } from "@shared/forms";
import { activeQuestions, isPickable, type Evaluation, type Form, type WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { useAction } from "@/hooks/useAction";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { call } from "@/lib/firebase";
import { queries } from "@/lib/firestore/refs";
import { formatDateTime, metricValue } from "@/lib/format";
import { createForm, setFormStatus } from "@/lib/formsAdmin";
import { paths } from "@/lib/paths";
import { mutualPairs } from "@/lib/picks";
import { FORM_KIND_LABELS, FORM_STATE_LABELS } from "@/components/admin/formLabels";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, LinkRow, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Admin d'un evenement : ses formulaires et ce qui fait son resultat
// ----------------------------
// Monte par la page de l'evenement (EventEditor). Chaque bloc suit ce qui est
// attache (SPECS §2) : toute saisie est un FORMULAIRE de l'evenement (Debrief,
// jury, picks, feedback), cree ici depuis un modele puis regle dans l'editeur ;
// le Debrief et les avis entre pairs demandent un matching.
// Les metriques sont les questions du Debrief, la grille celles du jury.
// Le leaderboard est recalcule par le serveur ; le jury a un seul lien
// partage, que le staff recopie ou remplace, et se verrouille en fermant son
// formulaire.

const JURY = "__jury__";

/** Les modeles de formulaire proposes pour un evenement ; le Debrief, seulement avec un matching. */
const EVENT_FORM_TEMPLATES: FormTemplateKey[] = ["debrief", "jury", "picks", "exercise_feedback", "session_feedback", "founder_introductions", "weekly_feedback"];

export function EventResultsAdmin() {
  const { matching, metrics, criteria, juryForm } = useAdminEvent();
  return (
    <>
      <FormsSection />
      {(metrics.length > 0 || criteria.length > 0) && <RankingSection />}
      {matching && metrics.length > 0 && <ResultsSection />}
      {juryForm && <JurySection juryForm={juryForm} />}
      <PicksSection />
    </>
  );
}

/** Les formulaires de l'evenement, et ceux a creer depuis un modele. */
function FormsSection() {
  const router = useRouter();
  const { event, forms, matching } = useAdminEvent();
  const { batch } = useAdmin();
  const { isBusy, run } = useAction();
  const nowISO = new Date().toISOString();
  const offered = EVENT_FORM_TEMPLATES.filter((key) => key !== "debrief" || matching !== null);

  const create = async (templateKey: FormTemplateKey) => {
    const id = await run(() => createForm({ programId: batch.programId, batchId: batch.id, templateKey, eventId: event.id, event }), "Draft created");
    if (id) router.push(paths.adminForm(id));
  };

  return (
    <Section
      title={`Forms · ${forms.length}`}
      hint="Everything founders and the jury enter for this event is a form: the debrief (team results, a word on each teammate), the jury, the picks, feedback. Create one from a model, then adjust its questions."
    >
      {forms.length > 0 && (
        <RowList>
          {forms.map((f) => {
            const state = formState(f, nowISO);
            return (
              <LinkRow
                key={f.id}
                href={paths.adminForm(f.id)}
                title={f.title}
                subtitle={FORM_KIND_LABELS[f.kind]}
                meta={<Text size="sm" c={state === "open" ? "pioneers" : "dimmed"}>{FORM_STATE_LABELS[state]}</Text>}
              />
            );
          })}
        </RowList>
      )}
      <Group gap="xs">
        {offered.map((key) => (
          <Button key={key} variant="default" disabled={isBusy} onClick={() => void create(key)}>
            New {FORM_TEMPLATES[key].label.toLowerCase()}
          </Button>
        ))}
      </Group>
    </Section>
  );
}

/** Ce qui classe le leaderboard : les notes du jury, ou une metrique du Debrief. */
function RankingSection() {
  const { event, metrics } = useAdminEvent();
  const { isBusy, run } = useAction();
  const value = event.rankingMetricKey ?? JURY;

  const change = (next: string | null) => {
    if (!next || next === value) return;
    void run(() => call("setEventRanking")({ eventId: event.id, metricKey: next === JURY ? null : next }), "Leaderboard updated");
  };

  const options = [{ value: JURY, label: "Jury scores" }, ...metrics.map((m) => ({ value: m.key, label: m.label }))];
  return (
    <Section title="Leaderboard" hint="What ranks the teams. A number is a metric question of the debrief, entered by each team.">
      {options.length <= 3 ? (
        <SegmentedControl fullWidth maw={480} data={options} value={value} onChange={change} disabled={isBusy} />
      ) : (
        <Select maw={480} data={options} value={value} onChange={change} disabled={isBusy} allowDeselect={false} />
      )}
    </Section>
  );
}

/** Les resultats de chaque equipe publiee (Debrief), a ouvrir pour les corriger. */
function ResultsSection() {
  const { event, teams, submissionsByTeamId, metrics } = useAdminEvent();
  const published = teams.filter((t) => t.publishedDateISOString !== null);
  const entered = published.filter((t) => submissionsByTeamId.get(t.id)?.submittedDateISOString).length;

  return (
    <Section title={`Results · ${entered} of ${published.length}`} hint="What each team entered in its debrief. Open a team to enter or correct its numbers.">
      {published.length === 0 ? (
        <Empty>Teams show up here once they are published.</Empty>
      ) : (
        <RowList>
          {published.map((t) => {
            const values = submissionsByTeamId.get(t.id)?.metrics ?? {};
            const summary = metrics
              .filter((m) => values[m.key] !== undefined)
              .map((m) => `${metricValue(m, values[m.key])} ${m.label.toLowerCase()}`)
              .join(" · ");
            return <LinkRow key={t.id} href={paths.adminEventTeam(event.id, t.id)} title={t.name} subtitle={summary || "No results yet"} />;
          })}
        </RowList>
      )}
    </Section>
  );
}

/**
 * Le jury : son formulaire (grille), un lien partage (sans compte), les notes
 * recues, le verrou (fermer le formulaire). Une feuille papier se saisit en
 * ouvrant le lien et en tapant le nom du jure.
 */
function JurySection({ juryForm }: { juryForm: WithId<Form> }) {
  const { event, teams, juryLink, evaluations, criteria } = useAdminEvent();
  const { isBusy, run } = useAction();
  const [isResetting, setResetting] = useState(false);
  const [selected, setSelected] = useState<WithId<Evaluation> | null>(null);

  const isPublished = juryForm.version > 0;
  const juryState = formState(juryForm, new Date().toISOString());
  const isOpen = juryState === "open";
  const url = juryLink ? `${window.location.origin}${paths.juryForm(juryForm.id, juryLink.secret)}` : null;
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const targetLabel = (id: string) => teamName.get(id) ?? id;
  const judgesCount = new Set(evaluations.map((e) => e.evaluatorId)).size;

  const resetLink = async () => {
    if (await run(() => call("resetJuryLink")({ eventId: event.id }), juryLink ? "New link ready" : "Link ready")) setResetting(false);
  };
  const remove = async (e: WithId<Evaluation>) => {
    if (await run(() => call("deleteJuryScore")({ eventId: event.id, evaluationId: e.id }), "Score deleted")) setSelected(null);
  };

  return (
    <Section
      title={`Jury · ${judgesCount} ${judgesCount === 1 ? "judge" : "judges"}`}
      right={<Text size="sm" c={isOpen ? "pioneers" : "dimmed"}>{juryState === "closed" ? "Locked" : FORM_STATE_LABELS[juryState]}</Text>}
      hint="One link for the whole jury, no account needed: each judge picks or types their name, then scores every team. A founder cannot score their own team. For a paper sheet, open the link and type the judge's name."
    >
      <Stack gap="sm" maw={480}>
        <LinkRow
          href={paths.adminForm(juryForm.id)}
          title="Scoring grid"
          subtitle={criteria.length ? criteria.map((c) => `${c.label} (${c.weight})`).join(" · ") : "No rating question yet"}
        />
        {!isPublished && <Text size="sm" c="dimmed">Publish the jury form to open the scores.</Text>}
        {url ? (
          <>
            <Text size="sm" c="dimmed" style={{ overflowWrap: "anywhere" }}>
              {url}
            </Text>
            <Group gap="xs">
              <CopyButton value={url}>
                {({ copied, copy }) => (
                  <Button variant="default" onClick={copy}>
                    {copied ? "Copied" : "Copy the link"}
                  </Button>
                )}
              </CopyButton>
              <Button variant="subtle" color="gray" onClick={() => setResetting(true)}>
                New link
              </Button>
            </Group>
          </>
        ) : (
          <Button size="md" fullWidth loading={isBusy} onClick={resetLink}>
            Create the jury link
          </Button>
        )}
        {isPublished && (
          <>
            <Button
              variant="default"
              fullWidth
              disabled={isBusy}
              onClick={() => void run(() => setFormStatus(juryForm.id, juryState === "closed" ? "open" : "closed"), juryState === "closed" ? "Scores open again" : "Scores locked")}
            >
              {juryState === "closed" ? "Unlock scores" : "Lock scores"}
            </Button>
            <Text size="xs" c="dimmed">
              {juryState === "closed"
                ? "Locked: nobody can add or change a score. Unlocking opens the jury form again."
                : "Locking closes the jury form: nobody can add or change a score until you unlock it."}
            </Text>
          </>
        )}
      </Stack>

      {evaluations.length === 0 ? (
        <Empty>No scores yet.</Empty>
      ) : (
        <RowList>
          {evaluations.map((e) => (
            <ButtonRow
              key={e.id}
              onClick={() => setSelected(e)}
              title={e.evaluatorName}
              subtitle={[targetLabel(e.targetId), criteria.map((c) => e.scores[c.key] ?? "-").join(" ")].join(" · ")}
            />
          ))}
        </RowList>
      )}

      <ResponsiveDialog opened={isResetting} onClose={() => setResetting(false)} title="New jury link">
        <Stack>
          <Text size="sm" c="dimmed">
            The current link stops working at once: share the new one with the jury. Scores already given stay.
          </Text>
          <Button size="md" fullWidth loading={isBusy} onClick={resetLink}>
            Make a new link
          </Button>
        </Stack>
      </ResponsiveDialog>

      <ResponsiveDialog
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.evaluatorName} · ${targetLabel(selected.targetId)}` : "Score"}
      >
        {selected && (
          <Stack>
            <RowList>
              {criteria.map((c) => (
                <Row key={c.key} title={c.label} meta={selected.scores[c.key] === undefined ? "-" : `${selected.scores[c.key]} / ${c.max}`} />
              ))}
            </RowList>
            {selected.comment && <Text size="sm">{selected.comment}</Text>}
            <Text size="xs" c="dimmed">
              Last saved {formatDateTime(selected.updatedDateISOString)}
            </Text>
            <Button size="md" fullWidth color="red" variant="light" loading={isBusy} onClick={() => void remove(selected)}>
              Delete this score
            </Button>
          </Stack>
        )}
      </ResponsiveDialog>
    </Section>
  );
}

/**
 * Les choix prives de l'evenement (questions « picks » de ses formulaires) :
 * les mutual picks (hackathon de 3 jours), le « qui t'a marque » d'un speed
 * dating. Le staff voit les choix reciproques, a apparier en premier. Ouvrir
 * ou clore les choix, c'est ouvrir ou fermer leur formulaire.
 */
function PicksSection() {
  const { event, forms } = useAdminEvent();
  const { batch, founders, foundersById } = useAdmin();
  // Les choix ne s'ecrivent que par un formulaire « picks » : sans lui, rien a lire.
  const hasPicksForm = forms.some((f) => activeQuestions(f).some((q) => q.dbField === "picks.pickedFounderIds"));
  const picks = useQueryListener(hasPicksForm ? queries.picksOfEvent(event.id) : null);
  if (!hasPicksForm) return null;

  const mutual = mutualPairs(picks.data);
  const nameOf = (id: string) => foundersById.get(id)?.name ?? id;
  const pickable = founders.filter((f) => isPickable(f, batch.id)).length;

  return (
    <Section title="Picks" hint="Private choices, ranked, from the picks question of this event's forms. Only the staff sees them.">
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
