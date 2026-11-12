import dayjs from "dayjs";

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

/** Jours entiers d'aujourd'hui au jour donne (negatif si passe). */
export function daysUntil(day: string): number {
  return dayjs(day).startOf("day").diff(dayjs().startOf("day"), "day");
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

/** Score sur 10 : `7.4`, `-` sans donnee. */
export const score10 = (v: number | null | undefined) => (v === null || v === undefined ? "-" : v.toFixed(1));

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
