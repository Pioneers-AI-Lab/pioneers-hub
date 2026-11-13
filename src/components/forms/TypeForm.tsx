"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Button, Group, Text, TextInput, Textarea, VisuallyHidden } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { PublicChoice, PublicForm, PublicFormQuestion } from "@shared/callables";
import { FORM_ANSWER_MAX, ratingScale } from "@shared/formRules";
import { needsAccount as needsAccountFor, type FormResponseStatus } from "@shared/types";
import { call } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, searchKey } from "@/lib/format";
import { paths } from "@/lib/paths";
import { markAnonymousFormDone } from "@/hooks/useAnonymousFormsDone";
import { draftsFromPrefill, newSubmissionId, problemOf, toAnswers, type Draft, type Drafts } from "@/components/forms/formDrafts";
import styles from "./TypeForm.module.css";

// ----------------------------
// Formulaire public, une question par ecran (facon Typeform)
// ----------------------------
// Repris du parcours de reservation de Trippple (BookingModal) :
//
// - Les etapes sont des volets SUPERPOSES, plutot que remplaces l'un par
//   l'autre. La question quittee s'efface en montant quand on avance, en
//   descendant quand on revient : le mouvement dit ou l'on va. La suivante est
//   deja en place, ses elements apparaissent en cascade (l'enonce, sa
//   precision, puis de quoi repondre) une fois la sortie finie. Tout est en CSS
//   (TypeForm.module.css), sans minuteur.
// - Seuls la question affichee et ses deux voisines ont un contenu : ce sont
//   les seules qui entrent ou sortent. Les reponses vivent ici, rien ne se perd.
// - Les volets hors ecran sont `inert` : la tabulation ne descend pas dans des
//   champs invisibles.
// - Une barre d'avancement sans chiffres : annoncer « 3 / 12 » d'entree fait
//   renoncer avant d'avoir commence.
// - Un choix unique (option, note, nom) avance au clic : la reponse est donnee.
//
// Clavier : Entree valide (Maj + Entree : nouvelle ligne dans un texte long),
// A, B, C... choisissent une option, 1 a 9 (et 0 pour 10) donnent une note.

type Step =
  | { kind: "intro" }
  | { kind: "name" }
  | { kind: "question"; question: PublicFormQuestion; number: number }
  | { kind: "done" };

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Au-dela, une liste se cherche plutot qu'elle ne se parcourt. */
const SEARCH_FROM = 8;
const ANONYMOUS_NOTE = "Anonymous: your name is not recorded.";
const NAME_QUESTION = "Who are you?";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

/** Touche d'une note : 1 a 9, et 0 pour 10, quand l'echelle tient sur un clavier. */
const ratingShortcut = (n: number, scale: { min: number; max: number }) =>
  scale.max - scale.min < 10 && scale.min >= 0 ? String(n % 10) : undefined;

const stepLabel = (step: Step, form: PublicForm) =>
  step.kind === "question" ? step.question.label : step.kind === "name" ? NAME_QUESTION : step.kind === "done" ? "Thank you" : form.title;

export function TypeForm({ form }: { form: PublicForm }) {
  const needsAccount = needsAccountFor(form.identityCheck) && !form.viewerFounderId;
  const canAnswer = (form.state === "open" || form.state === "draft") && !needsAccount;
  const isPreview = form.state === "draft";
  const asksName = form.identityCheck === "select_name" && !form.viewerFounderId;

  const steps: Step[] = [
    { kind: "intro" },
    ...(canAnswer && asksName ? [{ kind: "name" } as const] : []),
    ...(canAnswer ? form.questions.map((question, i) => ({ kind: "question" as const, question, number: i + 1 })) : []),
    { kind: "done" },
  ];
  const doneIndex = steps.length - 1;
  const lastInputIndex = doneIndex - 1;

  const viewportRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState<{ index: number; isForward: boolean } | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFromPrefill(form.prefill));
  const [respondent, setRespondent] = useState<string | null>(form.viewerFounderId);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<FormResponseStatus | null>(null);
  const [submissionId] = useState(newSubmissionId);

  const step = steps[index];
  const isLastInput = index === lastInputIndex;
  const respondentLabel = form.respondents.find((r) => r.value === respondent)?.label ?? null;

  // La question affichee prend le focus (sans defilement : la pile porte le
  // mouvement). Sans champ, c'est le volet : le clavier repond tout de suite.
  useEffect(() => {
    const slide = viewportRef.current?.querySelector<HTMLElement>("[data-current]");
    if (!slide) return;
    slide.scrollTop = 0;
    (slide.querySelector<HTMLElement>("input, textarea") ?? slide).focus({ preventScroll: true });
  }, [index]);

  // Raccourcis hors des champs de saisie : Entree pour l'action du volet, une
  // lettre ou un chiffre pour l'option qui la porte. Lu dans le DOM du volet
  // courant : rien a resynchroniser d'une etape a l'autre.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, button, a")) return;
      const slide = viewportRef.current?.querySelector<HTMLElement>("[data-current]");
      const target =
        e.key === "Enter"
          ? slide?.querySelector<HTMLButtonElement>("[data-primary]")
          : e.key.length === 1
            ? slide?.querySelector<HTMLButtonElement>(`[data-shortcut="${CSS.escape(e.key.toUpperCase())}"]`)
            : null;
      if (!target || target.disabled) return;
      e.preventDefault();
      target.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function goTo(next: number) {
    setLeaving({ index, isForward: next > index });
    setIndex(next);
    setError(null);
  }

  function setDraft(questionId: string, value: Draft) {
    setDrafts((current) => ({ ...current, [questionId]: value }));
    setError(null);
  }

  async function submit(current: Drafts, who: string | null) {
    setIsSending(true);
    try {
      const { data } = await call("submitFormResponse")({
        formId: form.formId,
        version: form.version,
        submissionId,
        respondent: who ? { founderId: who } : null,
        answers: toAnswers(current, (key) => form.questions.find((q) => q.id === key)?.type),
      });
      // Le serveur ne sait pas qui a envoye une reponse anonyme : ce navigateur la retire du « To do ».
      if (form.identityCheck === "anonymous" && form.viewerFounderId) markAnonymousFormDone(form.viewerFounderId, form.formId);
      setStatus(data.status);
      goTo(doneIndex);
    } catch (err) {
      notifications.show({ color: "red", title: "Not sent", message: errorMessage(err) });
    } finally {
      setIsSending(false);
    }
  }

  /**
   * Valide l'etape affichee, puis avance (ou envoie, a la derniere). Un choix
   * qui avance au clic passe sa valeur : l'etat ne l'a pas encore.
   */
  function next(current: Drafts = drafts, who: string | null = respondent) {
    if (isSending) return;
    if (step.kind === "name" && !who) return setError("Choose your name to continue.");
    if (step.kind === "question") {
      const problem = problemOf(step.question, current[step.question.id]);
      if (problem) return setError(problem);
    }
    if (!isLastInput) goTo(index + 1);
    else if (!isPreview) void submit(current, who);
  }

  function pickOne(questionId: string, value: Draft) {
    setDraft(questionId, value);
    next({ ...drafts, [questionId]: value });
  }

  function toggle(questionId: string, value: string, max: number | null) {
    const selected = (drafts[questionId] as string[] | undefined) ?? [];
    if (selected.includes(value)) return setDraft(questionId, selected.filter((v) => v !== value));
    if (max !== null && selected.length >= max) return setError(`Choose ${max} at most.`);
    setDraft(questionId, [...selected, value]);
  }

  /** Entree avance ; dans un texte long, Maj + Entree (et Entree sur mobile) va a la ligne. */
  function onFieldKey(e: KeyboardEvent<HTMLElement>, multiline: boolean) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (multiline && (e.shiftKey || window.matchMedia("(pointer: coarse)").matches)) return;
    e.preventDefault();
    next();
  }

  const action = (label: string, hint: string | null) => (
    <Group gap="md" className={styles.actions}>
      <Button size="md" data-primary loading={isSending} disabled={isPreview && isLastInput} onClick={() => next()}>
        {isPreview && isLastInput ? "Preview only" : label}
      </Button>
      {hint && <span className={styles.hint}>{hint}</span>}
    </Group>
  );
  const errorLine = error && <p className={styles.error}>{error}</p>;

  function renderStep(s: Step): ReactNode {
    switch (s.kind) {
      case "intro":
        return (
          <>
            {(form.event || form.batchName) && <p className={styles.eyebrow}>{[form.batchName, form.event?.name].filter(Boolean).join(" · ")}</p>}
            <h1 className={styles.title}>{form.title}</h1>
            {form.description && <p className={styles.description}>{form.description}</p>}
            <IntroNotes form={form} needsAccount={needsAccount} />
            {canAnswer && action(steps.length > 2 ? "Start" : "Submit", "press Enter")}
          </>
        );
      case "name":
        return (
          <>
            <QuestionHeading label={NAME_QUESTION} required description="Choose your name in the list." />
            <ChoiceList
              choices={form.respondents}
              selected={respondent ? [respondent] : []}
              onPick={(value) => {
                setRespondent(value);
                setError(null);
                next(drafts, value);
              }}
              searchLabel="Find your name"
            />
            {errorLine}
            {action("OK", null)}
          </>
        );
      case "question": {
        const q = s.question;
        const { field, hint } = renderField(q, s.number);
        return (
          <>
            <QuestionHeading number={s.number} label={q.label} required={q.required} description={q.description} />
            {field}
            {errorLine}
            {action(isLastInput ? "Submit" : "OK", hint)}
          </>
        );
      }
      case "done":
        return (
          <>
            <h1 className={styles.title}>Thank you</h1>
            <p className={styles.description}>
              {status === "pending_approval"
                ? "Your answers were sent. The Pioneers team reviews some of them before they update the hub."
                : "Your answers were sent."}
            </p>
            <Group className={styles.actions}>
              <Button component={Link} href={paths.home()} variant="default" size="md">
                Go to Pioneers Hub
              </Button>
            </Group>
          </>
        );
    }
  }

  /** De quoi repondre a une question, et le raccourci clavier a rappeler. */
  function renderField(q: PublicFormQuestion, number: number): { field: ReactNode; hint: string | null } {
    const value = drafts[q.id];
    const text = typeof value === "string" ? value : "";
    switch (q.type) {
      case "text":
      case "number":
      case "link":
      case "file":
        return {
          hint: "press Enter",
          field: (
            <>
              <TextInput
                variant="unstyled"
                classNames={{ input: styles.lineInput }}
                aria-label={q.label}
                placeholder={q.type === "number" ? "Type a number" : q.type === "text" ? "Type your answer here" : "https://"}
                inputMode={q.type === "number" ? "decimal" : q.type === "text" ? undefined : "url"}
                maxLength={q.type === "text" ? FORM_ANSWER_MAX.text : q.type === "number" ? undefined : FORM_ANSWER_MAX.link}
                autoComplete="off"
                enterKeyHint={number === form.questions.length ? "done" : "next"}
                value={text}
                onChange={(e) => setDraft(q.id, e.currentTarget.value)}
                onKeyDown={(e) => onFieldKey(e, false)}
                error={Boolean(error)}
              />
              {q.type === "file" && <p className={styles.note}>Share a link to the file (Google Drive, Dropbox, Notion...).</p>}
            </>
          ),
        };
      case "long_text":
        return {
          hint: "Shift + Enter for a new line",
          field: (
            <Textarea
              variant="unstyled"
              classNames={{ input: styles.lineInput }}
              aria-label={q.label}
              placeholder="Type your answer here"
              autosize
              minRows={2}
              maxRows={10}
              maxLength={FORM_ANSWER_MAX.long_text}
              value={text}
              onChange={(e) => setDraft(q.id, e.currentTarget.value)}
              onKeyDown={(e) => onFieldKey(e, true)}
              error={Boolean(error)}
            />
          ),
        };
      case "rating": {
        const scale = ratingScale(q);
        const values = Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i);
        return {
          hint: null,
          field: (
            <div className={styles.scale} role="radiogroup" aria-label={q.label}>
              {values.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={value === n}
                  className={cx(styles.option, styles.scaleItem, value === n && styles.selected, "num")}
                  data-shortcut={ratingShortcut(n, scale)}
                  onClick={() => pickOne(q.id, n)}
                >
                  {n}
                </button>
              ))}
            </div>
          ),
        };
      }
      case "single_choice":
      case "multiple_choice": {
        const isMulti = q.type === "multiple_choice";
        return {
          hint: null,
          field: (
            <>
              {isMulti && <p className={styles.note}>Choose as many as you like.</p>}
              <ChoiceList
                choices={q.options ?? []}
                selected={Array.isArray(value) ? value : text ? [text] : []}
                multiple={isMulti}
                onPick={(v) => (isMulti ? toggle(q.id, v, null) : pickOne(q.id, v))}
                searchLabel={q.label}
              />
            </>
          ),
        };
      }
      case "entity_picker": {
        const max = q.picker?.maxItems ?? 1;
        const isFounder = q.picker?.entity === "founder";
        // On ne se choisit pas soi-meme : le nom choisi a l'etape « Who are you? » sort de la liste.
        const choices = (q.picker ? (form.choices[q.picker.entity] ?? []) : []).filter((c) => !isFounder || c.value !== respondent);
        return {
          hint: null,
          field: (
            <>
              {max > 1 && <p className={styles.note}>Choose up to {max}{isFounder ? ", your first choice first" : ""}.</p>}
              <ChoiceList
                choices={choices}
                selected={Array.isArray(value) ? value : []}
                multiple={max > 1}
                ranked={isFounder && max > 1}
                onPick={(v) => (max > 1 ? toggle(q.id, v, max) : pickOne(q.id, [v]))}
                searchLabel={q.label}
              />
            </>
          ),
        };
      }
    }
  }

  const progress = index / doneIndex;
  return (
    <div className={styles.shell} data-direction={leaving && !leaving.isForward ? "back" : "forward"}>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span className={styles.bar} style={{ width: `${progress * 100}%` }} />
      </div>

      <header className={styles.header}>
        <Link href={paths.home()} aria-label="Pioneers Hub" className="auth-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG statique, pas d'optimisation utile. */}
          <img src="/logo-pioneers-hub.svg" alt="Pioneers Hub" width={173} height={28} />
        </Link>
      </header>

      {/* Le titre visible change a chaque pas, ce qu'un lecteur d'ecran n'annonce pas : cette region le redit. */}
      <VisuallyHidden aria-live="polite">{stepLabel(step, form)}</VisuallyHidden>

      <main ref={viewportRef} className={styles.viewport}>
        {steps.map((s, position) => (
          <section
            key={s.kind === "question" ? s.question.id : s.kind}
            className={cx(styles.slide, position === index && styles.current, position === leaving?.index && position !== index && styles.leaving)}
            data-current={position === index || undefined}
            inert={position !== index || undefined}
            tabIndex={-1}
          >
            {Math.abs(position - index) <= 1 && <div className={cx(styles.group, styles.cascade)}>{renderStep(s)}</div>}
          </section>
        ))}
      </main>

      <footer className={styles.footer}>
        <Text size="sm" c="dimmed" truncate>
          {form.identityCheck === "anonymous" ? ANONYMOUS_NOTE : respondentLabel && step.kind !== "intro" ? `Answering as ${respondentLabel}` : ""}
        </Text>
        <Button variant="subtle" color="gray" size="md" disabled={index === 0 || index === doneIndex || isSending} onClick={() => goTo(index - 1)}>
          Back
        </Button>
      </footer>
    </div>
  );
}

function IntroNotes({ form, needsAccount }: { form: PublicForm; needsAccount: boolean }) {
  if (form.state === "closed") {
    return (
      <>
        <p className={styles.note}>This form is closed. It no longer accepts answers.</p>
        <GivenAnswers form={form} />
      </>
    );
  }
  if (form.state === "not_open_yet") return <p className={styles.note}>This form is not open yet. Come back later.</p>;
  if (needsAccount) {
    return (
      <>
        <p className={styles.note}>Sign in with your Pioneers account to answer: this form is tied to your name.</p>
        <Group>
          <Button component={Link} href={paths.signIn(paths.form(form.formId))} size="md">
            Sign in
          </Button>
        </Group>
      </>
    );
  }
  const lines = [
    form.deadlineDateISOString ? `Due ${formatDateTime(form.deadlineDateISOString)}` : null,
    form.identityCheck === "anonymous" ? ANONYMOUS_NOTE : null,
    form.state === "draft" ? "Draft: you are previewing it. Publish the form to collect answers." : null,
  ].filter(Boolean);
  return lines.length > 0 ? <p className={styles.note}>{lines.join(" · ")}</p> : null;
}

/** Les reponses deja donnees d'un formulaire clos (picks : ses choix, dans l'ordre), pour les relire. */
function GivenAnswers({ form }: { form: PublicForm }) {
  const given = form.questions.flatMap((q) => {
    const value = form.prefill[q.id];
    if (value === undefined || value === null) return [];
    const labelOf = (v: string) => (q.picker ? form.choices[q.picker.entity]?.find((c) => c.value === v)?.label : undefined) ?? v;
    const text = Array.isArray(value) ? value.map((v, i) => (q.picker ? `${i + 1}. ${labelOf(v)}` : v)).join(q.picker ? ", " : "\n") : String(value);
    return [{ id: q.id, label: q.label, text }];
  });
  if (given.length === 0) return null;
  return (
    <>
      {given.map((g) => (
        <p key={g.id} className={styles.note}>
          <strong>{g.label}</strong>
          <br />
          {g.text}
        </p>
      ))}
    </>
  );
}

function QuestionHeading({
  number,
  label,
  required,
  description,
}: {
  number?: number;
  label: string;
  required: boolean;
  description: string | null;
}) {
  return (
    <>
      <h2 className={styles.question}>
        {number !== undefined && <span className={cx(styles.number, "num")}>{number}</span>}
        {label}
        {required && (
          <span className={styles.required} aria-label="required">
            *
          </span>
        )}
      </h2>
      {description && <p className={styles.description}>{description}</p>}
    </>
  );
}

/**
 * Options a choisir. Courte, la liste porte une lettre par option (A, B, C) ;
 * longue (les noms du batch), elle se cherche, et Entree choisit le seul
 * resultat restant.
 */
function ChoiceList({
  choices,
  selected,
  multiple = false,
  ranked = false,
  onPick,
  searchLabel,
}: {
  choices: PublicChoice[];
  selected: string[];
  multiple?: boolean;
  /** Choix classes (picks) : le rang de chaque choix s'affiche, dans l'ordre du clic. */
  ranked?: boolean;
  onPick: (value: string) => void;
  searchLabel: string;
}) {
  const [query, setQuery] = useState("");
  const isSearchable = choices.length >= SEARCH_FROM;
  const q = searchKey(query);
  const visible = q ? choices.filter((c) => searchKey(`${c.label} ${c.hint ?? ""}`).includes(q)) : choices;

  if (choices.length === 0) return <p className={styles.note}>Nothing to choose from yet. Ask the Pioneers team.</p>;

  return (
    <>
      {isSearchable && (
        <TextInput
          variant="unstyled"
          classNames={{ input: styles.lineInput }}
          aria-label={searchLabel}
          placeholder="Type to search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || visible.length !== 1) return;
            e.preventDefault();
            onPick(visible[0].value);
          }}
        />
      )}
      <div className={cx(styles.choices, isSearchable && styles.scrollList)} role={multiple ? "group" : "radiogroup"} aria-label={searchLabel}>
        {visible.map((c, i) => {
          const isSelected = selected.includes(c.value);
          const letter = !isSearchable ? LETTERS[i] : undefined;
          const rank = ranked && isSelected ? selected.indexOf(c.value) + 1 : null;
          return (
            <button
              key={c.value}
              type="button"
              role={multiple ? "checkbox" : "radio"}
              aria-checked={isSelected}
              className={cx(styles.option, styles.choice, isSelected && styles.selected)}
              data-shortcut={letter}
              onClick={() => onPick(c.value)}
            >
              {rank !== null ? <span className={cx(styles.key, "num")}>{rank}</span> : letter && <span className={styles.key}>{letter}</span>}
              <span className={styles.choiceText}>
                {c.label}
                {c.hint && <span className={styles.choiceHint}>{c.hint}</span>}
              </span>
            </button>
          );
        })}
        {visible.length === 0 && <p className={styles.note}>No match. Check the spelling.</p>}
      </div>
    </>
  );
}
