import { canSeeEvent } from "./access";
import { isPublishedEvent } from "./events";
import type { PioneersEvent } from "./types";

// ----------------------------
// Calendrier d'un batch, au format iCalendar (RFC 5545)
// ----------------------------
// Servi par l'API (`GET /calendar/{batchId}.ics`) : on s'y ABONNE une fois
// (Apple, Google, Outlook), et un nouvel evenement ou une heure corrigee par le
// staff arrive tout seul. Un evenement garde son `UID` (son id) : le calendrier
// le met a jour au lieu de le dupliquer. Pur : pas de Node, pas de Firebase.

/** L'adresse du calendrier d'un batch, sur l'API publique. */
export const calendarPath = (batchId: string) => `/calendar/${encodeURIComponent(batchId)}.ics`;

/**
 * Ce que contient le calendrier du batch : les evenements publies ouverts a TOUT
 * le batch. Un evenement a audience restreinte (office hours, visio de mentorat :
 * `audience: "guests"`) n'y entre pas : l'adresse est la meme pour tous, et
 * chacun verrait les rendez-vous des autres.
 */
export const isBatchCalendarEvent = (e: Pick<PioneersEvent, "status" | "archivedDateISOString" | "audience" | "guestFounderIds" | "startupIds">) =>
  isPublishedEvent(e) && canSeeEvent("public", null, null, e);

/** Le nom du calendrier chez l'abonne : « Pioneers fa26 ». */
export const calendarName = (batchName: string) => `Pioneers ${batchName}`;

/** Duree affichee d'un evenement sans fin connue. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;
/** Domaine des `UID` : ne change jamais, sinon chaque abonne verrait des doublons. */
const UID_DOMAIN = "pioneers-hub";
const encoder = new TextEncoder();

/** `2026-11-16T08:30:00.000Z` -> `20261116T083000Z`. */
const icsDate = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Echappe une valeur texte (virgule, point-virgule, antislash, retour a la ligne). */
const icsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Replie une ligne a 75 octets, comme l'exige la norme (suite precedee d'une espace). */
function fold(line: string): string {
  if (line.length <= 75 && !/[^\x00-\x7f]/.test(line)) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (encoder.encode(current + char).length > limit) {
      parts.push(current);
      current = char;
    } else current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function batchCalendar(input: {
  batchName: string;
  /** Page du batch, en lien de chaque evenement. */
  url: string;
  events: (Pick<
    PioneersEvent,
    "name" | "topic" | "location" | "startDateISOString" | "endDateISOString" | "updatedDateISOString"
  > & { id: string })[];
}): string {
  // DTSTAMP = derniere modification : le texte ne change qu'avec les evenements
  // (l'ETag permet alors au CDN et aux abonnes de ne rien retelecharger).
  const stamp = icsDate(input.events.reduce((max, e) => (e.updatedDateISOString > max ? e.updatedDateISOString : max), "1970-01-01T00:00:00.000Z"));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pioneers//Pioneers Hub//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(calendarName(input.batchName))}`,
    "X-WR-TIMEZONE:Europe/Paris",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of input.events) {
    const end = e.endDateISOString ?? new Date(new Date(e.startDateISOString).getTime() + DEFAULT_DURATION_MS).toISOString();
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@${UID_DOMAIN}`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${icsDate(e.updatedDateISOString)}`,
      `DTSTART:${icsDate(e.startDateISOString)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsText(e.name)}`,
      ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
      ...(e.topic ? [`DESCRIPTION:${icsText(e.topic)}`] : []),
      `URL:${input.url}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
