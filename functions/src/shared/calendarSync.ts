import { parisDay, parisMidnight } from "./dates";
import { sameTime } from "./eventForms";
import { newEvent, type EventData } from "./events";
import { searchKey } from "./text";
import type { Batch, CalendarSource, PioneersEvent, WithId } from "./types";

// ----------------------------
// L'agenda Google, source des evenements d'un batch (decision du 16/11, SPECS §2)
// ----------------------------
// Sens unique : Google -> Hub. L'agenda fait foi pour le nom, les dates, le lieu,
// la description et la visio (`CALENDAR_FIELDS`) ; le Hub garde le reste (invites,
// etiquette, template, matching, formulaires, jalon, liens). Seuls les
// evenements de la periode du batch (jours de Paris) entrent : un agenda peut
// servir a plusieurs batchs.
//
// Pur : le service (services/calendarSync.ts) lit Google et la base, ce module
// dit quoi ecrire. Rejoue sur les memes changements, il n'ecrit rien de plus :
// un evenement deja a jour n'est pas reecrit.

/** Ce que l'agenda porte, et que le Hub ne modifie plus (Admin, API, Claude, scripts, regles). */
export const CALENDAR_FIELDS = ["name", "topic", "startDateISOString", "endDateISOString", "location", "videoCallUrl"] as const;
export type CalendarFields = Pick<PioneersEvent, (typeof CALENDAR_FIELDS)[number]>;

/** L'evenement vient de l'agenda Google : ses `CALENDAR_FIELDS` sont verrouilles. */
export const isFromCalendar = (e: Pick<PioneersEvent, "calendarSource">) => Boolean(e.calendarSource);

/** Sans les champs de l'agenda : ce que le Hub ecrit sur un evenement qui en vient. */
export const withoutCalendarFields = <T extends object>(o: T): Omit<T, (typeof CALENDAR_FIELDS)[number]> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !(CALENDAR_FIELDS as readonly string[]).includes(k))) as Omit<T, (typeof CALENDAR_FIELDS)[number]>;

/** Le batch tire ses evenements d'un agenda Google : on ne les cree plus dans le Hub. */
export const calendarIdOf = (batch: Pick<Batch, "settings">): string | null => batch.settings.googleCalendarId?.trim() || null;

/** L'agenda que la synchro suit pour ce batch : relie, ni archive ni termine ; `null` sinon (tache planifiee, notifications). */
export const syncedCalendarIdOf = (batch: Pick<Batch, "settings" | "status" | "archivedDateISOString">): string | null =>
  batch.archivedDateISOString === null && batch.status !== "completed" ? calendarIdOf(batch) : null;

/** Le message d'un refus de creation dans un batch relie a un agenda. */
export const CALENDAR_BATCH_MESSAGE = "This batch's events come from its Google Calendar: create the event there, it shows up in the Hub within a minute.";

/** Ce que l'API Google Calendar (v3, `events.list`) rend d'un evenement, ce qui sert ici. */
export type GoogleCalendarEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  /** Le lien Google Meet, s'il y en a un. */
  hangoutLink?: string;
  /** La visio attachee (Meet, Zoom, Teams... par un module de l'agenda). */
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

// ---- Champs ---------------------------------------------------------------------------

const timeOf = (t: GoogleCalendarEvent["start"]): string | null =>
  t?.dateTime ? new Date(t.dateTime).toISOString() : t?.date ? parisMidnight(t.date) : null;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** La description Google est du HTML leger (liens, gras, retours a la ligne) : le Hub la garde en texte. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, text: string) => (text && text !== href ? `${text} (${href})` : href))
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, e: string) => ENTITIES[e])
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Le lien de la visio : Meet, sinon le point d'entree video d'une autre visio. */
const videoCallOf = (g: GoogleCalendarEvent): string | null =>
  g.hangoutLink ?? g.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video" && p.uri)?.uri ?? null;

/** Les champs du Hub tires d'un evenement Google ; `null` sans debut (inutilisable). */
export function calendarFieldsOf(g: GoogleCalendarEvent): CalendarFields | null {
  const start = timeOf(g.start);
  if (!start) return null;
  return {
    name: g.summary?.trim() || "(No title)",
    topic: g.description ? htmlToText(g.description) || null : null,
    startDateISOString: start,
    endDateISOString: timeOf(g.end),
    location: g.location?.trim() || null,
    videoCallUrl: videoCallOf(g),
  };
}

/** Dans la periode du batch : du jour de debut au jour de fin (inclus), a Paris. */
export const isInBatchPeriod = (startISO: string, batch: Pick<Batch, "startDayString" | "endDayString">) => {
  const day = parisDay(startISO);
  return day >= batch.startDayString && (batch.endDayString === null || day <= batch.endDayString);
};

/** L'id d'un evenement cree par la synchro : deterministe, deux synchros ne le creent pas deux fois. */
export const calendarEventDocId = (batchId: string, googleEventId: string) => `${batchId}_gcal_${googleEventId}`;

/** Deux noms qui se valent : sans accents, casse ni espaces en trop (« Démo  day » = « Demo Day »). */
const nameKey = (name: string) => searchKey(name).replace(/\s+/g, " ");

// ---- Le plan ------------------------------------------------------------------------

export type CalendarUpdate = {
  event: WithId<PioneersEvent>;
  /** Les champs qui changent (et `calendarSource` pour un evenement relie). */
  patch: Partial<CalendarFields> & { calendarSource?: CalendarSource };
  /** Un evenement du Hub relie pour la premiere fois a son evenement Google. */
  isLink: boolean;
};

/** Son horaire change : ses formulaires suivent (`planEventMove`). */
export const isMovedBy = (u: CalendarUpdate) => "startDateISOString" in u.patch || "endDateISOString" in u.patch;

export type CalendarSyncPlan = {
  creates: { id: string; data: EventData }[];
  updates: CalendarUpdate[];
  /** Annules, supprimes ou sortis de la periode : masques (archives). */
  archives: WithId<PioneersEvent>[];
  /** Evenements Google de la periode vus par cette synchro. */
  seen: number;
};

/**
 * Ce que la synchro ecrit, d'apres les changements Google (`changes`) et les
 * evenements du batch (archives compris : un evenement masque reste relie, et
 * n'est jamais recree). `isFull` : `changes` est TOUT l'agenda (premiere synchro,
 * jeton expire) : un evenement relie absent a ete supprime.
 *
 * Relier a la connexion : un evenement du Hub non relie, non archive, de meme
 * debut et de meme nom (ou le seul de ce debut) devient le reflet de l'evenement
 * Google au lieu d'un doublon.
 */
export function planCalendarSync(input: {
  batch: WithId<Pick<Batch, "programId" | "startDayString" | "endDayString">>;
  calendarId: string;
  changes: readonly GoogleCalendarEvent[];
  isFull: boolean;
  events: readonly WithId<PioneersEvent>[];
}): CalendarSyncPlan {
  const { batch, calendarId, changes, isFull } = input;
  const linked = new Map(
    input.events.flatMap((e) => (e.calendarSource?.calendarId === calendarId ? [[e.calendarSource.eventId, e] as const] : [])),
  );
  const unlinked = input.events.filter((e) => !e.calendarSource && e.archivedDateISOString === null);
  const plan: CalendarSyncPlan = { creates: [], updates: [], archives: [], seen: 0 };
  const archive = (event: WithId<PioneersEvent>) => {
    if (event.archivedDateISOString === null) plan.archives.push(event);
  };

  // Le dernier etat de chaque evenement (une page peut en repeter un).
  const latest = new Map(changes.map((g) => [g.id, g]));
  for (const g of latest.values()) {
    const event = linked.get(g.id);
    const fields = g.status === "cancelled" ? null : calendarFieldsOf(g);
    if (!fields || !isInBatchPeriod(fields.startDateISOString, batch)) {
      if (event) archive(event);
      continue;
    }
    plan.seen += 1;
    const source: CalendarSource = { provider: "google", calendarId, eventId: g.id, htmlLink: g.htmlLink ?? null };

    if (event) {
      const patch = changedFields(event, fields);
      if (event.calendarSource?.htmlLink !== source.htmlLink) Object.assign(patch, { calendarSource: source });
      if (Object.keys(patch).length) plan.updates.push({ event, patch, isLink: false });
      continue;
    }

    const sameStart = unlinked.filter((e) => sameTime(e.startDateISOString, fields.startDateISOString));
    const key = nameKey(fields.name);
    const match = sameStart.find((e) => nameKey(e.name) === key) ?? (sameStart.length === 1 ? sameStart[0] : undefined);
    if (match) {
      unlinked.splice(unlinked.indexOf(match), 1);
      plan.updates.push({ event: match, patch: { ...changedFields(match, fields), calendarSource: source }, isLink: true });
      continue;
    }

    const data = newEvent(
      {
        programId: batch.programId,
        batchId: batch.id,
        templateKey: null,
        name: fields.name,
        startDateISOString: fields.startDateISOString,
        endDateISOString: fields.endDateISOString,
        status: "scheduled",
        location: fields.location,
      },
      { topic: fields.topic, videoCallUrl: fields.videoCallUrl, calendarSource: source },
    );
    plan.creates.push({ id: calendarEventDocId(batch.id, g.id), data });
  }

  // Une synchro complete voit tout l'agenda : un evenement relie qui n'y est plus a ete supprime.
  if (isFull) for (const [googleId, event] of linked) if (!latest.has(googleId)) archive(event);
  return plan;
}

const TIME_FIELDS: ReadonlySet<keyof CalendarFields> = new Set(["startDateISOString", "endDateISOString"]);

/** Les champs d'agenda qui different (un champ absent d'un evenement d'avant vaut `null`). */
function changedFields(event: CalendarFields, fields: CalendarFields): Partial<CalendarFields> {
  const patch: Partial<CalendarFields> = {};
  for (const key of CALENDAR_FIELDS) {
    const was = event[key] ?? null;
    const now = fields[key] ?? null;
    if (TIME_FIELDS.has(key) ? !sameTime(was, now) : was !== now) Object.assign(patch, { [key]: now });
  }
  return patch;
}
