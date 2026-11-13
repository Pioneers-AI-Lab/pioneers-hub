// ----------------------------
// data/events.json -> documents `events` et options de leurs formulaires
// ----------------------------
// Partage par scripts/import-events.mjs (cree sans jamais toucher a l'existant)
// et scripts/sync-events.mjs (met a jour sur le planning) : un evenement du
// fichier devient le meme document dans les deux.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { EVENT_TEMPLATES } = require("../../functions/lib/shared/presets/eventTemplates.js");
const { defaultStartTime, newEvent } = require("../../functions/lib/shared/events.js");

/** Le fichier et les evenements d'une semaine du programme. */
export function readEventsFile(week) {
  const data = JSON.parse(readFileSync(new URL("../../data/events.json", import.meta.url), "utf8"));
  const selected = data.events.filter((e) => e.programWeek === week);
  if (selected.length === 0) throw new Error(`Aucun evenement pour « ${week} »`);
  return { data, selected };
}

/** Heure de Paris -> ISO. Les dates du batch sont en hiver (UTC+1). */
export const parisISO = (day, time) => new Date(`${day}T${time}:00+01:00`).toISOString();
export const parisLabel = (iso) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 16);

/**
 * Le document d'un evenement du fichier. Sans heure (`startDateISOString` vide) :
 * a l'heure par defaut du modele ; hors lunch roulette, en brouillon.
 */
export function toEvent(data, e, now) {
  if (e.templateKey && !EVENT_TEMPLATES[e.templateKey]) throw new Error(`${e.key}: modele inconnu ${e.templateKey}`);
  const timeless = !e.startDateISOString;
  if (timeless && !e.dayString) throw new Error(`${e.key}: ni heure ni jour`);
  const event = newEvent(
    {
      programId: data.programId,
      batchId: data.batchId,
      templateKey: e.templateKey,
      kind: e.kind,
      name: e.name,
      startDateISOString: e.startDateISOString ?? parisISO(e.dayString, defaultStartTime(e.templateKey ?? null)),
      // Sans fin : la duree du modele.
      endDateISOString: e.endDateISOString ?? null,
      status: timeless && e.templateKey !== "lunch_roulette" ? "draft" : "scheduled",
      location: e.location,
      // `null` dans le fichier : pas de tirage (le speed dating se fait a la main).
      ...("matching" in e ? { matching: e.matching } : {}),
    },
    {
      topic: e.topic ?? null,
      programWeek: e.programWeek,
      isMilestone: e.isMilestone,
      audience: e.audience,
      guests: e.guests,
      rankingMetricKey: e.rankingMetricKey ?? null,
      scoring: e.scoring ?? null,
    },
  );
  return { ...event, createdDateISOString: now, updatedDateISOString: now };
}

/**
 * Les options de ses formulaires (shared/eventForms.ts) : le pack du modele,
 * plus `forms` ; les reglages du fichier (metriques, grille, champs de la
 * Submission, seances de la retro) et `formSettings` : par modele, `opens` /
 * `deadline` (heure de Paris, le jour de l'evenement) et `draft`.
 */
export function formOptions(e) {
  const formDates = {};
  for (const [templateKey, s] of Object.entries(e.formSettings ?? {})) {
    formDates[templateKey] = {
      ...(s.opens ? { opensDateISOString: parisISO(e.dayString, s.opens) } : {}),
      ...(s.deadline ? { deadlineDateISOString: parisISO(e.dayString, s.deadline) } : {}),
      ...(s.draft ? { draft: true } : {}),
    };
  }
  return {
    forms: [...new Set([...(EVENT_TEMPLATES[e.templateKey]?.forms ?? []), ...(e.forms ?? [])])],
    metrics: e.metrics ?? null,
    criteria: e.criteria ?? null,
    submissionFields: e.submissionFields ?? null,
    sessions: e.sessions ?? [],
    formDates,
  };
}
