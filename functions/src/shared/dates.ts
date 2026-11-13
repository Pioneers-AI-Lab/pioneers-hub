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
