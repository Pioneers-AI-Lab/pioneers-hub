import type { formState } from "@shared/forms";
import type { FieldWriteStatus, FormApproval, FormIdentityCheck, FormKind, FormResponseStatus, FormStatus, QuestionScope } from "@shared/types";

// Libelles des formulaires dans l'interface staff (en anglais).

export const FORM_KIND_LABELS: Record<FormKind, string> = {
  onboarding: "Onboarding",
  motivation: "Weekly motivation",
  goal: "Goal form",
  weekly_update: "Thursday update",
  exercise_feedback: "Exercise feedback",
  session_feedback: "Session feedback",
  peer_feedback: "Peer feedback",
  debrief: "Hackathon debrief",
  jury: "Jury",
  picks: "Picks",
  exit: "Exit form",
  custom: "Custom",
};

export const FORM_STATUS_LABELS: Record<FormStatus, string> = { draft: "Draft", open: "Open", closed: "Closed" };

/** L'etat du lien d'un formulaire (`formState`) : son statut, ou « Scheduled » avant son ouverture. */
export const FORM_STATE_LABELS: Record<ReturnType<typeof formState>, string> = { ...FORM_STATUS_LABELS, not_open_yet: "Scheduled" };

/** `email_code` (ancien nom d'`account`) n'est plus propose : il se lit comme `account`. */
export const IDENTITY_OPTIONS: { value: FormIdentityCheck; label: string }[] = [
  { value: "select_name", label: "Pick name" },
  { value: "account", label: "Sign in" },
  { value: "jury_link", label: "Jury link" },
  { value: "anonymous", label: "Anonymous" },
];

export const IDENTITY_HINTS: Record<FormIdentityCheck, string> = {
  select_name: "The respondent picks their name from the batch list (never typed).",
  account: "The respondent signs in with their Pioneers account. They find their answers again and can change them while the form is open. For the debrief and picks.",
  email_code: "The respondent signs in with their Pioneers account (former email-code setting).",
  jury_link: "One shared link with a secret, no account: each judge picks or types their name, then scores every team. For a jury.",
  anonymous: "No identity: answers are tied to the batch and the event only.",
};

/** Comment se remplit une question, selon sa portee (editeur, reponses). */
export const SCOPE_LABELS: Record<QuestionScope, string> = {
  self: "The respondent",
  team: "Their team",
  each_teammate: "Each teammate",
  each_target: "Each team scored",
};

export const APPROVAL_OPTIONS: { value: FormApproval; label: string }[] = [
  { value: "none", label: "Write answers to the database directly" },
  { value: "conflicts_only", label: "Approve only answers that replace a value" },
  { value: "all", label: "Approve every answer before writing" },
];

/** Statut d'une reponse, et sa couleur : bleu = a traiter par le staff. */
export const RESPONSE_STATUS: Record<FormResponseStatus, { label: string; color: string }> = {
  processed: { label: "Done", color: "dimmed" },
  pending_approval: { label: "To review", color: "pioneers" },
  partially_rejected: { label: "Partly rejected", color: "dimmed" },
};

/** Ce qu'une reponse a fait d'une valeur dans la base. */
export const WRITE_STATUS: Record<FieldWriteStatus, { label: string; color: string }> = {
  applied: { label: "Written", color: "dimmed" },
  pending_approval: { label: "To review", color: "pioneers" },
  rejected: { label: "Rejected", color: "dimmed" },
  unchanged: { label: "Unchanged", color: "dimmed" },
  invalid: { label: "Invalid", color: "red" },
};
