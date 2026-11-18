import { eventTemplateOf } from "./presets/eventTemplates";
import { invitedFounderIds, isBatchParticipant, type Attendance, type AttendanceStatus, type Form, type Founder, type PioneersEvent } from "./types";

// ----------------------------
// Qui est attendu a un evenement, qui est absent (SPECS, fonctionnalite Presence)
// ----------------------------
// LA regle, partagee par l'audience des formulaires (`formRules` : relances du
// staff, To do du fondateur), la saisie du staff (Admin > Events > Attendance),
// le tirage des groupes et le serveur (choix de fondateurs, picks).
//   - Attendus : les participants du batch (`isBatchParticipant`), ou les
//     invites d'un evenement a audience restreinte (`invitedFounderIds`).
//   - Tout le monde est present par defaut ; le staff marque les absents. Au
//     premier geste, la saisie enregistre presents tous les attendus sans
//     document (`unmarkedIds`) : la presence est alors « relevee » pour tous,
//     et chaque fondateur lit la sienne.
//   - Un absent ne recoit pas les formulaires de l'evenement, n'est pas tire au
//     sort ni propose (ou accepte) dans ses picks.

export type AttendanceFounder = Pick<Founder, "batchId" | "status" | "archivedDateISOString" | "isExternalFounder" | "startupId"> & { id: string };
export type AttendanceEvent = Pick<PioneersEvent, "audience" | "guestFounderIds" | "startupIds">;
type Mark = Pick<Attendance, "founderId" | "status">;

/** Les absents marques (un document `absent`). */
export const absentFounderIds = (attendance: readonly Mark[]): Set<string> =>
  new Set(attendance.filter((a) => a.status === "absent").map((a) => a.founderId));

export type EventRoster<F extends AttendanceFounder> = {
  /** Les attendus, chacun avec son statut (present sans document). */
  rows: { founder: F; status: AttendanceStatus }[];
  /** Attendus sans document : enregistres presents au premier geste. */
  unmarkedIds: string[];
  /** Au moins un attendu a un document : la presence a ete relevee. */
  isTaken: boolean;
  /** Audience restreinte : les attendus sont les invites. */
  isRestricted: boolean;
};

/** Les attendus de l'evenement (du batch `batchId`) parmi `founders`, et leur presence. */
export function eventRoster<F extends AttendanceFounder>(
  batchId: string,
  event: AttendanceEvent,
  founders: readonly F[],
  attendance: readonly Mark[],
): EventRoster<F> {
  const participants = founders.filter((f) => isBatchParticipant(f, batchId));
  const invited = invitedFounderIds(event, participants);
  const statusOf = new Map(attendance.map((a) => [a.founderId, a.status]));
  const expected = invited ? participants.filter((f) => invited.has(f.id)) : participants;
  const unmarkedIds = expected.filter((f) => !statusOf.has(f.id)).map((f) => f.id);
  return {
    rows: expected.map((founder) => ({ founder, status: statusOf.get(founder.id) ?? "present" })),
    unmarkedIds,
    isTaken: unmarkedIds.length < expected.length,
    isRestricted: invited !== null,
  };
}

/**
 * Presence optionnelle (docs/FONCTIONNALITES.md §1) : relevee, mais
 * ni la presence ni les formulaires de l'evenement ne comptent dans Engagement
 * (services/scores.ts). Les absents restent hors des formulaires et du tirage.
 */
export const isAttendanceOptional = (event: Pick<PioneersEvent, "attendanceOptional">): boolean => event.attendanceOptional === true;

/**
 * L'evenement a une presence : pas celui d'un template sans reunion (`withoutAttendance` : le
 * Weekly update, decision du 18/11). Sans presence, il ne compte pas dans Engagement, et ses
 * formulaires vont a tout le batch (`formRules.ts#formAudience`) : aucun absent, meme marque.
 */
export const tracksAttendance = (event: Pick<PioneersEvent, "templateKey">): boolean => !eventTemplateOf(event.templateKey)?.withoutAttendance;

/** Les absents comptent pour ce formulaire (refuses, ni proposes ni acceptes) : il est rattache a un evenement qui a une presence. */
export const formHasAbsentees = (form: Pick<Form, "eventId">, event: Pick<PioneersEvent, "templateKey"> | null): boolean =>
  form.eventId !== null && (!event || tracksAttendance(event));

/**
 * La presence de chaque fondateur aux evenements OBLIGATOIRES de `events` (Engagement) :
 * ceux ou il etait attendu (`total`) et ceux ou il n'etait pas absent (`attended`). Sans
 * aucun marquage, tous presents. Un evenement optionnel ou sans presence ne compte pas.
 */
export function mandatoryAttendance<F extends AttendanceFounder>(
  batchId: string,
  events: readonly (AttendanceEvent & Pick<PioneersEvent, "attendanceOptional" | "templateKey"> & { id: string })[],
  founders: readonly F[],
  attendanceByEvent: ReadonlyMap<string, readonly Mark[]>,
): Map<string, { attended: number; total: number }> {
  const out = new Map(founders.map((f) => [f.id, { attended: 0, total: 0 }]));
  for (const e of events) {
    if (isAttendanceOptional(e) || !tracksAttendance(e)) continue;
    for (const row of eventRoster(batchId, e, founders, attendanceByEvent.get(e.id) ?? []).rows) {
      const a = out.get(row.founder.id);
      if (!a) continue;
      a.total += 1;
      if (row.status !== "absent") a.attended += 1;
    }
  }
  return out;
}
