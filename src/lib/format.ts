import dayjs from "dayjs";

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

export const PROFILE_CATEGORY_LABEL = { technical: "Tech", business: "Business", hybrid: "Hybrid" } as const;
