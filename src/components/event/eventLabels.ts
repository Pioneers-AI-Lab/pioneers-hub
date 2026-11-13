import dayjs from "dayjs";
import { defaultStartTime, eventLabelOf, type EventPhase } from "@shared/events";
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus, type EventKind, type EventStatus, type PioneersEvent } from "@shared/types";

/** L'etiquette d'un evenement (son type n'est qu'une etiquette, decision du 13/11). */
export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  team_challenge: "Team challenge",
  pitch: "Pitch",
  matching: "Matching",
  session: "Session",
  meeting: "Meeting",
};

/** L'etiquette affichee d'un evenement : le nom de son modele, sinon celle de son type. */
export const eventLabel = (event: Pick<PioneersEvent, "templateKey" | "kind">) => eventLabelOf(event, EVENT_KIND_LABEL[event.kind]);

/** Le cycle d'un evenement, avec ce qu'il change pour les fondateurs et le jury. */
export const EVENT_STATUS_OPTIONS: { value: EventStatus; label: string; description: string }[] = [
  { value: "draft", label: "Draft", description: "Only the staff sees it" },
  { value: "scheduled", label: "Scheduled", description: "Visible to founders and in the calendar" },
  { value: "live", label: "Live", description: "Happening now, the jury can score" },
  { value: "locked", label: "Locked", description: "Scores are final" },
  { value: "completed", label: "Completed", description: "Done" },
];

export const EVENT_STATUS_LABEL = Object.fromEntries(EVENT_STATUS_OPTIONS.map((o) => [o.value, o.label])) as Record<EventStatus, string>;

/** Debut propose a la creation, pour un champ `datetime-local` : demain a l'heure du modele. */
export function defaultEventStart(templateKey: string | null): string {
  const [hour, minute] = defaultStartTime(templateKey).split(":").map(Number);
  return dayjs().add(1, "day").hour(hour).minute(minute).format("YYYY-MM-DDTHH:mm");
}

/** Phase d'un evenement (Admin > Events) : couleur du point et du statut ; gris passe, bleu a venir, vert aujourd'hui. */
export const EVENT_PHASE_STYLE: Record<EventPhase, { dot: string; color: string }> = {
  past: { dot: "dark.3", color: "dimmed" },
  upcoming: { dot: "pioneers", color: "pioneers" },
  today: { dot: "green", color: "green" },
};

/** Presence : libelle et couleur (fiche du fondateur, saisie du staff). */
export const ATTENDANCE_STYLE: Record<AttendanceStatus, { label: string; color: string }> = {
  present: { label: ATTENDANCE_STATUS_LABELS.present, color: "var(--mantine-color-pioneers-6)" },
  in_office: { label: ATTENDANCE_STATUS_LABELS.in_office, color: "var(--mantine-color-teal-7)" },
  late: { label: ATTENDANCE_STATUS_LABELS.late, color: "var(--mantine-color-yellow-7)" },
  absent: { label: ATTENDANCE_STATUS_LABELS.absent, color: "var(--mantine-color-dark-5)" },
};
