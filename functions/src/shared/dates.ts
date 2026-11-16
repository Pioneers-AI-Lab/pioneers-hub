// ----------------------------
// Jours et semaines, a Paris
// ----------------------------
// Le serveur tourne en UTC, le navigateur dans le fuseau du visiteur : un jour
// ou une semaine du programme se lit toujours a Paris. `Intl` seulement : pur,
// donc a sa place dans shared/.

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** Le jour a Paris, `YYYY-MM-DD`, d'un instant ISO. */
export const parisDay = (iso: string) => PARIS_DAY.format(new Date(iso));

/** Le jour a Paris, `YYYY-MM-DD`. */
export const parisToday = () => PARIS_DAY.format(new Date());

/**
 * Le lundi (`YYYY-MM-DD`) de la semaine d'un instant, a Paris : la cle des
 * documents de suivi (`founderWeeks`, `checkins`).
 */
export function parisMonday(iso: string): string {
  const d = new Date(`${parisDay(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const PARIS_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" });

/** Minuit a Paris, en ISO, d'un jour `YYYY-MM-DD` (evenement « toute la journee » de Google Calendar). */
export function parisMidnight(day: string): string {
  const utc = Date.parse(`${day}T00:00:00Z`);
  // A 00:00 UTC, Paris affiche 01:00 (hiver) ou 02:00 (ete) : c'est le decalage.
  return new Date(utc - Number(PARIS_HOUR.format(new Date(utc))) * 3_600_000).toISOString();
}
