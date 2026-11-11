import type { Archivable, DayString, Timestamps } from "./common";

// ----------------------------
// notes/{noteId}  (staff + investors IC)
// ----------------------------
// Notes internes (office hours, mentors, observations, copier-coller Granola,
// ajoutees via Claude), rattachees a un fondateur, une startup ou un mentor.
// Les tableaux d'ids permettent de retrouver toutes les notes d'un fondateur,
// y compris celles prises sur sa startup.

export type NoteTargetType = "founder" | "startup" | "mentor";

export type NoteSource = "office_hours" | "mentor" | "observation" | "granola" | "claude";

export type Note = Timestamps &
  Archivable & {
    programId: string;
    /** `null` pour une note sur un mentor, hors batch. */
    batchId: string | null;
    targetType: NoteTargetType;
    targetId: string;
    founderIds: string[];
    startupId: string | null;
    mentorId: string | null;
    /** Evenement d'ou vient la note (office hour, seance de mentorat). */
    eventId: string | null;
    authorUid: string;
    source: NoteSource;
    dayString: DayString;
    body: string;
  };
