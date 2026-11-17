import dayjs from "dayjs";
import { parisDay, parisToday } from "@shared/dates";
import type { ScoreScale } from "@shared/types";

export { searchKey } from "@shared/text";

// ----------------------------
// Affichage des dates et des nombres
// ----------------------------
// Les dates du modele sont des chaines (`YYYY-MM-DD`, ISO) : on ne les
// convertit qu'ici, pour l'affichage.

/** `2026-11-16` -> `16 Nov 2026` (`16 Nov` si `short`). */
export function formatDay(day: string | null | undefined, short = false): string {
  if (!day) return "-";
  const d = dayjs(day);
  return d.isValid() ? d.format(short ? "D MMM" : "D MMM YYYY") : day;
}

/** Instant ISO -> `Mon 16 Nov, 09:30`. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = dayjs(iso);
  return d.isValid() ? d.format("ddd D MMM, HH:mm") : iso;
}

/** Instant ISO -> `09:30` (l'heure seule, sous un titre de jour). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = dayjs(iso);
  return d.isValid() ? d.format("HH:mm") : iso;
}

/** La fin d'un evenement : l'heure seule le meme jour (de Paris, comme les titres de jour), sinon jour et heure. */
const formatEnd = (start: string, end: string) => (parisDay(start) === parisDay(end) ? formatTime(end) : formatDateTime(end));

/**
 * Sous le nom d'un evenement dont l'heure de debut est deja affichee a gauche (Calendar,
 * Next session) : `Until 11:00 · Lieu`, sans repeter le debut (`Until Fri 27 Nov, 19:30`
 * s'il finit un autre jour ; sans fin : le lieu seul).
 */
export function formatEndPlace(e: {
  startDateISOString: string;
  endDateISOString: string | null;
  location: string | null;
}): string {
  const until = e.endDateISOString ? `Until ${formatEnd(e.startDateISOString, e.endDateISOString)}` : null;
  return [until, e.location].filter(Boolean).join(" · ");
}

/** `Wed 18 Nov, 09:30 to 11:30` : le jour n'est repete que si la fin tombe un autre jour. */
export function formatDateTimeRange(start: string, end: string | null): string {
  return end ? `${formatDateTime(start)} to ${formatEnd(start, end)}` : formatDateTime(start);
}

/** Jours entiers d'aujourd'hui (ou du jour `from`, `YYYY-MM-DD`) au jour donne (negatif si passe). */
export function daysUntil(day: string, from?: string): number {
  return dayjs(day).startOf("day").diff(dayjs(from).startOf("day"), "day");
}

/** `YYYY-MM-DD` -> `Wed 18 Nov` (annee ajoutee hors de l'annee de Paris en cours). */
export function formatWeekDay(day: string, today = parisToday()): string {
  const d = dayjs(day);
  return d.isValid() ? d.format(day.slice(0, 4) === today.slice(0, 4) ? "ddd D MMM" : "ddd D MMM YYYY") : day;
}

/**
 * Titre d'un jour de l'agenda (`YYYY-MM-DD`, un jour de Paris : `parisDay`), compare au jour
 * de Paris (pas a celui du navigateur) : `Today · Sun 15 Nov`, `Tomorrow · Mon 16 Nov`, sinon
 * `Wed 18 Nov` (`formatWeekDay`).
 */
export function formatDayTitle(day: string): string {
  const today = parisToday();
  const label = formatWeekDay(day, today);
  const n = daysUntil(day, today);
  return n === 0 ? `Today · ${label}` : n === 1 ? `Tomorrow · ${label}` : label;
}

/** `in 5 days`, `today`, `tomorrow`, `3 days ago`. */
export function relativeDays(day: string): string {
  const n = daysUntil(day);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** `16 Nov 2026 to 25 Feb 2027`, ou `From 16 Nov 2026` sans fin. */
export function formatPeriod(start: string, end: string | null): string {
  return end ? `${formatDay(start)} to ${formatDay(end)}` : `From ${formatDay(start)}`;
}

export const todayDayString = () => dayjs().format("YYYY-MM-DD");

/** Une liste lisible, `-` si vide. */
export const joinList = (values: readonly string[] | null | undefined, sep = ", ") =>
  values && values.length > 0 ? values.join(sep) : "-";

export { PROFILE_CATEGORY_LABELS as PROFILE_CATEGORY_LABEL } from "@shared/types";

/** Un score sur son echelle (`ScoreScale`) : entier sur 100 (« 74 », « 112 » avec une mention), une decimale sur 10. */
export const formatScore = (v: number | null | undefined, scale: ScoreScale) =>
  v === null || v === undefined ? "-" : scale === 100 ? `${Math.round(v)}` : v.toFixed(1);

/** Le remplissage d'une barre de score, de 0 a 100 % : au-dessus de l'echelle (Outstanding), pleine. */
export const scoreFill = (v: number | null | undefined, scale: ScoreScale) => Math.min(100, ((v ?? 0) / scale) * 100);

/**
 * D'ou vient un sous-score, en une ligne : « Hackathons (3): 74 · Peer ratings (4): 63 ».
 * Seulement sur 100 (les signaux importes de Spring 2026 n'ont pas ces libelles) ; `undefined` sans signal.
 */
export const scoreSourceLine = (signals: readonly { label: string; score: number }[] | undefined, scale: ScoreScale) =>
  scale === 100 && signals?.length ? signals.map((s) => `${s.label}: ${formatScore(s.score, scale)}`).join(" · ") : undefined;

/** Un oui / non affichable : `Yes`, `No`, `null` sans reponse (champ masque). */
export const yesNoLabel = (v: boolean | null | undefined) => (v === true ? "Yes" : v === false ? "No" : null);

/** Part 0-1 -> `77%`. */
export const percent = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${Math.round(v * 100)}%`);

/** Montant en dollars, abrege : `$2.5B`, `$120M`, `$40K`. */
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

/** Nombre entier lisible : `12 400`. */
export const integer = (v: number | null | undefined) =>
  v === null || v === undefined ? "-" : Math.round(v).toLocaleString("en-US").replace(/,/g, " ");

/** Un instant ISO pour un champ `datetime-local` (`YYYY-MM-DDTHH:mm`, heure locale), et retour. */
export const toLocalInput = (iso: string | null) => (iso ? dayjs(iso).format("YYYY-MM-DDTHH:mm") : "");
export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

/** La valeur d'une metrique d'evenement avec son unite : « 1 250 EUR », « 12.5 % », « 42 ». */
export function metricValue(metric: { unit: string | null }, v: number): string {
  const n = Number.isInteger(v) ? integer(v) : v.toFixed(1);
  return metric.unit ? `${n} ${metric.unit}` : n;
}
