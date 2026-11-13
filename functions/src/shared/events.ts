import { parisDay } from "./dates";
import { EVENT_TEMPLATES, eventTemplateOf, type EventTemplateKey } from "./presets/eventTemplates";
import { GENERATOR_PRESETS, teamSizeFor } from "./teamGenerator";
import type { EventGuest, EventKind, EventMatching, PioneersEvent, Timestamps } from "./types";

// ----------------------------
// Un evenement : sa construction et sa visibilite
// ----------------------------
// Une seule facon de construire un document `events` : Admin > Events, les
// `create_event` et l'import (scripts/import-events.mjs, par functions/lib).
// Un modele est un pack (presets/eventTemplates.ts) : l'evenement prend son
// etiquette, sa duree et son matching ; ses formulaires sont crees a cote
// (shared/eventForms.ts). Modifier un modele ne change aucun evenement existant.

export type NewEventInput = {
  programId: string;
  batchId: string;
  /** `null` : evenement cree a blanc (etiquette `kind`, `session` par defaut). */
  templateKey: EventTemplateKey | null;
  /** Etiquette d'un evenement sans modele ; celle du modele sinon. */
  kind?: EventKind;
  name: string;
  startDateISOString: string;
  /** `null` : la duree du modele (une heure sans modele). */
  endDateISOString?: string | null;
  status: PioneersEvent["status"];
  location?: string | null;
  /** Par defaut, celui du modele (`null` sans modele). */
  matching?: EventMatching | null;
};

/** Les copies des invites (requetes `array-contains`), qui suivent toujours `guests`. */
export const guestCopiesOf = (guests: readonly EventGuest[]): Pick<PioneersEvent, "guestFounderIds" | "mentorIds"> => ({
  guestFounderIds: guests.flatMap((g) => (g.founderId ? [g.founderId] : [])),
  mentorIds: guests.flatMap((g) => (g.mentorId ? [g.mentorId] : [])),
});

/** Duree d'un evenement sans fin ni modele : une heure (comme le calendrier). */
export const DEFAULT_DURATION_MINUTES = 60;

/** La fin a partir du debut et d'une duree. */
export const endAfter = (startISO: string, minutes: number) => new Date(Date.parse(startISO) + minutes * 60_000).toISOString();

/** Un document `events` sans ses horodatages (poses a l'ecriture). */
export type EventData = Omit<PioneersEvent, keyof Timestamps>;

/** Le document d'un nouvel evenement ; `extra` complete ou remplace les valeurs par defaut (import). */
export function newEvent(input: NewEventInput, extra: Partial<Omit<EventData, "kind" | "templateKey">> = {}): EventData {
  const template = input.templateKey ? EVENT_TEMPLATES[input.templateKey] : null;
  const kind = template?.kind ?? input.kind ?? "session";
  const guests = extra.guests ?? [];

  return {
    programId: input.programId,
    batchId: input.batchId,
    archivedDateISOString: null,
    kind,
    name: input.name,
    templateKey: input.templateKey,
    stage: template?.stage ?? null,
    topic: null,
    startDateISOString: input.startDateISOString,
    endDateISOString: input.endDateISOString ?? endAfter(input.startDateISOString, template?.durationMinutes ?? DEFAULT_DURATION_MINUTES),
    location: input.location ?? null,
    programWeek: null,
    isMilestone: false,
    audience: "batch",
    guests,
    ...guestCopiesOf(guests),
    startupIds: [],
    signUpUrl: null,
    resourceUrl: null,
    status: input.status,
    matching: input.matching !== undefined ? input.matching : (template?.matching ?? null),
    leaderboardRevealDateISOString: null,
    rankingMetricKey: null,
    ...extra,
  };
}

/** Ce que voient les fondateurs et le calendrier : ni brouillon (heure pas encore fixee), ni archive. */
export const isPublishedEvent = (e: Pick<PioneersEvent, "status" | "archivedDateISOString">) =>
  e.status !== "draft" && e.archivedDateISOString === null;

/** A venir : pas encore termine (la fin, a defaut le debut). Accueil du batch, « Me », Admin > Events. */
export const isUpcomingEvent = (e: Pick<PioneersEvent, "startDateISOString" | "endDateISOString">, nowISO: string) =>
  (e.endDateISOString ?? e.startDateISOString) >= nowISO;

export type EventPhase = "past" | "today" | "upcoming";

/** Passe (ou archive), aujourd'hui (en cours ou commence ce jour, a Paris), ou a venir. Admin > Events. */
export function eventPhaseOf(
  e: Pick<PioneersEvent, "status" | "startDateISOString" | "endDateISOString" | "archivedDateISOString">,
  nowISO: string,
): EventPhase {
  if (e.archivedDateISOString !== null || !isUpcomingEvent(e, nowISO)) return "past";
  return e.status === "live" || parisDay(e.startDateISOString) === parisDay(nowISO) ? "today" : "upcoming";
}

/** Heure de debut proposee, a Paris : celle du modele (12:30 pour une lunch roulette), 09:00 sans modele. */
export const defaultStartTime = (templateKey: string | null) => eventTemplateOf(templateKey)?.startTime ?? "09:00";

// ----------------------------
// Ce que l'evenement permet, d'apres ce qui lui est attache (decision du 13/11)
// ----------------------------
// Le type n'est qu'une etiquette : le tirage vient du matching, le jury de son
// formulaire. Un evenement d'avant le 13/11 n'a pas de champ `matching` : il se
// deduit de son ancienne mecanique et de sa taille d'equipe (`teamSize`).

type MatchingSource = Pick<PioneersEvent, "kind" | "matching" | "teamSize">;

/** Le matching de l'evenement, `null` sans tirage. */
export function matchingOf(event: MatchingSource): EventMatching | null {
  if (event.matching !== undefined) return event.matching;
  const mode = event.kind === "team_challenge" ? "challenge" : event.kind === "matching" ? "matching" : null;
  if (!mode) return null;
  return { mode, size: event.teamSize ?? teamSizeFor(GENERATOR_PRESETS[mode].defaultSize) };
}

/** Ce que note le jury : les groupes du matching s'il y en a un, sinon les startups de l'evenement. */
export const juryTargetOf = (event: MatchingSource): "team" | "startup" => (matchingOf(event) ? "team" : "startup");

/** L'etiquette affichee : le nom du modele, sinon celle du type. */
export const eventLabelOf = (event: Pick<PioneersEvent, "templateKey">, kindLabel: string) => eventTemplateOf(event.templateKey)?.label ?? kindLabel;

