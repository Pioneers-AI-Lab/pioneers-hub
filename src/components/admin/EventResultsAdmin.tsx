"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, CopyButton, Group, Stack, Text } from "@mantine/core";
import { FORM_TEMPLATES, isOfferedTemplate, type FormTemplate, type FormTemplateKey } from "@shared/presets/formTemplates";
import { isWorkTeamEvent } from "@shared/events";
import { formState } from "@shared/forms";
import { EVALUATION_DECISION_LABELS, isPickable, type Evaluation, type Form, type WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminEvent } from "@/context/AdminEventContext";
import { useAction } from "@/hooks/useAction";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { call } from "@/lib/firebase";
import { queries } from "@/lib/firestore/refs";
import { formatDateTime, metricValue, yesNoLabel } from "@/lib/format";
import { createForm, setFormStatus } from "@/lib/formsAdmin";
import { paths } from "@/lib/paths";
import { mutualPairs } from "@/lib/picks";
import { FORM_KIND_LABELS, FORM_STATE_LABELS } from "@/components/admin/formLabels";
import { LeaderboardSection } from "@/components/admin/ScoringEditor";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { ButtonRow, LinkRow, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { HelpBlock } from "@/components/ui/Help";

// ----------------------------
// Admin d'un evenement : ses formulaires et ce qui fait son resultat
// ----------------------------
// Monte par la page de l'evenement (EventEditor). Chaque bloc suit ce qui est
// attache (SPECS §2) : toute saisie est un FORMULAIRE de l'evenement (Debrief,
// jury, retro, pitch deck), ajoute depuis un modele (`EventFormsField` : la liste,
// puis « Add a form » -> le modele -> son editeur, qui ramene ici) ; le Debrief
// et les avis entre pairs demandent un matching.
// Les metriques sont les questions du Debrief, la grille celles du jury.
// Le leaderboard est recalcule par le serveur ; le jury a un seul lien
// partage, que le staff recopie ou remplace, et se verrouille en fermant son
// formulaire.

/**
 * Ce que recueille chaque modele de formulaire d'un evenement (pour le staff). Un modele retire
 * n'est pas propose (`isOfferedTemplate`) ; la Submission et le Peer rating, seulement avec des equipes de travail.
 */
const EVENT_FORM_TEMPLATES: Partial<Record<FormTemplateKey, string>> = {
  debrief: "Team results, sent by the team lead before the deadline",
  peer_rating: "Each founder scores their teammates, in private",
  jury: "One shared link: the jury scores every team, 0 to 5 per criterion",
  week_retro: "Energy, a score per session, more or less of what",
};

/** Ce qui fait le resultat de l'evenement : classement, resultats, jury, et les picks d'avant le 17/11. */
export function EventResultsAdmin() {
  const { matching, metrics, juryForm } = useAdminEvent();
  return (
    <>
      <LeaderboardSection />
      {matching && metrics.length > 0 && <ResultsSection />}
      {juryForm && <JurySection juryForm={juryForm} />}
      <PicksSection />
    </>
  );
}

/** Les formulaires de l'evenement, puis « Add a form » : le modele, puis son editeur. */
export function EventFormsField() {
  const router = useRouter();
  const { event, forms } = useAdminEvent();
  const { batch, events } = useAdmin();
  const { isBusy, run } = useAction();
  const [isPicking, setPicking] = useState(false);
  const nowISO = new Date().toISOString();
  const hasWorkTeams = isWorkTeamEvent(event);
  const offered = (Object.keys(EVENT_FORM_TEMPLATES) as FormTemplateKey[]).filter((key) => {
    const template: FormTemplate = FORM_TEMPLATES[key];
    return isOfferedTemplate(template) && (hasWorkTeams || !template.needsWorkTeams);
  });

  /** `null` : un formulaire vierge, rattache a l'evenement, aux dates de son modele dans l'evenement. */
  const create = async (templateKey: FormTemplateKey | null) => {
    const id = await run(() => createForm({ programId: batch.programId, batchId: batch.id, templateKey, eventId: event.id, event }, events), "Draft created");
    if (id) router.push(paths.adminForm(id));
  };

  return (
    <HelpBlock label="Forms" help="What founders and the jury enter for this event: results, ratings, scores, picks.">
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
        <ButtonRow opens onClick={() => setPicking(true)} title="Add a form" subtitle="Blank or from a model, then adjust its questions" />
      </RowList>

      <ResponsiveDialog opened={isPicking} onClose={() => setPicking(false)} title="Add a form">
        <RowList>
          <ButtonRow disabled={isBusy} onClick={() => void create(null)} title="Blank form" subtitle="No questions yet: write your own" />
          {offered.map((key) => (
            <ButtonRow key={key} disabled={isBusy} onClick={() => void create(key)} title={FORM_TEMPLATES[key].label} subtitle={EVENT_FORM_TEMPLATES[key]} />
          ))}
        </RowList>
        <Text size="xs" c="dimmed" mt="sm">
          The form gets its model&apos;s dates in this event (most open 15 min before the end and are due 24 h later): adjust them in its editor.
          {!hasWorkTeams && " The submission and the peer rating need a matching in teams."}
        </Text>
      </ResponsiveDialog>
    </HelpBlock>
  );
}

/** Les resultats de chaque equipe publiee (Debrief), a ouvrir pour les corriger. */
function ResultsSection() {
  const { event, teams, submissionsByTeamId, metrics } = useAdminEvent();
  const published = teams.filter((t) => t.publishedDateISOString !== null);
  const entered = published.filter((t) => submissionsByTeamId.get(t.id)?.submittedDateISOString).length;

  return (
    <Section title={`Results · ${entered} of ${published.length}`} help="What each team entered in its submission. Open a team to enter or correct its numbers.">
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
            const late = submissionsByTeamId.get(t.id)?.late === true;
            return (
              <LinkRow
                key={t.id}
                href={paths.adminEventTeam(event.id, t.id)}
                title={t.name}
                subtitle={[late ? "Late" : null, summary || "No results yet"].filter(Boolean).join(" · ")}
              />
            );
          })}
        </RowList>
      )}
    </Section>
  );
}

/** Les reponses d'un jure apres la grille Pitch (lot 5) : Overall, Decision, Would you invest?, How likely. */
const pitchVerdictRows = (e: Evaluation): { title: string; meta: string }[] =>
  [
    e.overallScore != null ? { title: "Overall", meta: `${e.overallScore} / 5` } : null,
    e.decision ? { title: "Decision", meta: EVALUATION_DECISION_LABELS[e.decision] } : null,
    e.wouldInvest != null ? { title: "Would you invest?", meta: yesNoLabel(e.wouldInvest)! } : null,
    e.betLikelihood != null ? { title: "Bet likelihood", meta: `${e.betLikelihood} / 5` } : null,
  ].filter((r): r is { title: string; meta: string } => r !== null);

/**
 * Le jury : son formulaire (grille), un lien partage (sans compte), les notes
 * recues, le verrou (fermer le formulaire). Une feuille papier se saisit en
 * ouvrant le lien et en tapant le nom du jure.
 */
function JurySection({ juryForm }: { juryForm: WithId<Form> }) {
  const { event, teams, juryLink, evaluations, criteria } = useAdminEvent();
  const { startups } = useAdmin();
  const { isBusy, run } = useAction();
  const [isResetting, setResetting] = useState(false);
  const [selected, setSelected] = useState<WithId<Evaluation> | null>(null);

  const isPublished = juryForm.version > 0;
  const juryState = formState(juryForm, new Date().toISOString());
  const isOpen = juryState === "open";
  const url = juryLink ? `${window.location.origin}${paths.juryForm(juryForm.id, juryLink.secret)}` : null;
  // Les equipes du matching, ou les startups d'un pitch.
  const teamName = new Map([...startups, ...teams].map((t) => [t.id, t.name]));
  const targetLabel = (id: string) => teamName.get(id) ?? id;
  const judgesCount = new Set(evaluations.map((e) => e.evaluatorId)).size;
  const selectedVerdicts = selected ? pitchVerdictRows(selected) : [];

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
      help="One link for the whole jury, no account needed: each judge picks or types their name, then scores every team. A founder cannot score their own team. For a paper sheet, open the link and type the judge's name."
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
            <ButtonRow opens
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
            {selectedVerdicts.length > 0 && (
              <RowList>
                {selectedVerdicts.map((r) => (
                  <Row key={r.title} title={r.title} meta={r.meta} />
                ))}
              </RowList>
            )}
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
 * Les choix prives de l'evenement, ARCHIVES : les picks sont retires le 17/11 (la Shortlist et Lock my
 * team les remplacent, docs/FONCTIONNALITES.md §4.6), et leurs formulaires archives.
 * Rien n'est efface : le staff relit ici ceux deja donnes (Founder introductions), et les choix reciproques.
 */
function PicksSection() {
  const { event } = useAdminEvent();
  const { batch, founders, foundersById, eventIdsWithPicks } = useAdmin();
  // Des picks n'ont pu s'ecrire que par un formulaire qui les demandait : sans lui, rien a lire.
  const picks = useQueryListener(eventIdsWithPicks.has(event.id) ? queries.picksOfEvent(event.id) : null);
  if (picks.data.length === 0) return null;

  const mutual = mutualPairs(picks.data);
  const nameOf = (id: string) => foundersById.get(id)?.name ?? id;
  const pickable = founders.filter((f) => isPickable(f, batch.id)).length;

  return (
    <Section title="Picks (archived)" help="Private choices given before the Shortlist replaced the picks (17/11). Only the staff sees them.">
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
