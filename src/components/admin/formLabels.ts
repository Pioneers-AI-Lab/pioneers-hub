import type { FormApproval, FormIdentityCheck, FormKind, FormStatus } from "@shared/types";

// Libelles des formulaires dans l'interface staff (en anglais).

export const FORM_KIND_LABELS: Record<FormKind, string> = {
  onboarding: "Onboarding",
  motivation: "Weekly motivation",
  goal: "Goal form",
  weekly_update: "Thursday update",
  exercise_feedback: "Exercise feedback",
  session_feedback: "Session feedback",
  peer_feedback: "Peer feedback",
  exit: "Exit form",
  custom: "Custom",
};

export const FORM_STATUS_LABELS: Record<FormStatus, string> = { draft: "Draft", open: "Open", closed: "Closed" };

export const IDENTITY_OPTIONS: { value: FormIdentityCheck; label: string }[] = [
  { value: "select_name", label: "Pick name" },
  { value: "email_code", label: "Email code" },
  { value: "anonymous", label: "Anonymous" },
];

export const IDENTITY_HINTS: Record<FormIdentityCheck, string> = {
  select_name: "The respondent picks their name from the batch list (never typed).",
  email_code: "The respondent picks their name, then confirms with a code sent by email. For peer feedback.",
  anonymous: "No identity: answers are tied to the batch and the event only.",
};

export const APPROVAL_OPTIONS: { value: FormApproval; label: string }[] = [
  { value: "none", label: "Write answers to the database directly" },
  { value: "conflicts_only", label: "Approve only answers that replace a value" },
  { value: "all", label: "Approve every answer before writing" },
];

/** Jours RRULE, lundi d'abord. */
export const WEEKDAYS = [
  { value: "MO", label: "Monday" },
  { value: "TU", label: "Tuesday" },
  { value: "WE", label: "Wednesday" },
  { value: "TH", label: "Thursday" },
  { value: "FR", label: "Friday" },
  { value: "SA", label: "Saturday" },
  { value: "SU", label: "Sunday" },
];

/** « Chaque jeudi a 10h » <-> `FREQ=WEEKLY;BYDAY=TH;BYHOUR=10;BYMINUTE=0`. */
export function parseWeeklyRule(rule: string | null): { day: string; time: string } | null {
  const match = rule?.match(/FREQ=WEEKLY;BYDAY=([A-Z]{2});BYHOUR=(\d{1,2});BYMINUTE=(\d{1,2})/);
  if (!match) return null;
  return { day: match[1], time: `${match[2].padStart(2, "0")}:${match[3].padStart(2, "0")}` };
}

export function weeklyRule(day: string | null, time: string): string | null {
  if (!day) return null;
  const [hour = "10", minute = "0"] = time.split(":");
  return `FREQ=WEEKLY;BYDAY=${day};BYHOUR=${Number(hour)};BYMINUTE=${Number(minute)}`;
}
