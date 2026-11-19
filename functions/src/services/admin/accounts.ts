import { getAuth, type UserRecord } from "firebase-admin/auth";
import { z } from "zod";
import { COL, docPaths } from "../../shared/collections";
import type { Batch, User } from "../../shared/types";
import { badRequest, forbidden, notFound } from "../../api/errors";
import { createSetPasswordLink, inviteAccount as invite, parseAccess, setAccountAccess as setAccess, setAccountDisabled as setDisabled } from "../accounts";
import { syncBatchCalendar } from "../calendarSync";
import type { Operation } from "../operations";
import { recomputeBatchScores } from "../scores";
import { effectPlan, mustRead, readDoc, staffOnly } from "./writes";

// ----------------------------
// services/admin - comptes, synchro de l'agenda, recalcul des scores
// ----------------------------
// Des actions qui ne tiennent pas dans une transaction Firestore (Firebase Auth,
// l'API Google Calendar, le recalcul d'un batch) : `plan` verifie et decrit,
// `effect` appelle LE service des callables d'Admin (memes regles), qui ecrit
// son audit detaille au nom de l'appelant de l'API (`effectAudits`).
//
// ⛔️ LE ROLE STAFF NE SE DONNE NI NE SE RETIRE PAR L'API (decision du 17/11) : un
// agent lit des textes ecrits par les fondateurs, une instruction cachee pourrait
// lui faire nommer quelqu'un staff. Un compte staff ne se bloque pas non plus
// d'ici. Ces gestes restent dans Admin > Access.

const AccessFields = {
  roles: z
    .array(z.enum(["investor", "mentor"]))
    .max(2)
    .describe("`investor` and/or `mentor`; empty = a plain account (founder or visitor). The staff role is given in the app only."),
  investorAccess: z.enum(["ic", "portfolio"]).nullable().optional().describe("Required for an investor: `ic` (internal data) or `portfolio`."),
};

/** Le compte vise : par `uid` (list `accounts`) ou par son email de connexion. */
const AccountTarget = {
  uid: z.string().min(1).optional().describe("The account's id (list `accounts`)."),
  email: z.email().optional().describe("Or its sign-in email."),
};

async function accountOf(input: { uid?: string; email?: string }): Promise<UserRecord> {
  if (!input.uid === !input.email) throw badRequest("missing_argument", "Give the account's `uid` or its `email`, not both.", "uid");
  const user = await (input.uid ? getAuth().getUser(input.uid) : getAuth().getUserByEmail(input.email!.trim().toLowerCase())).catch(() => null);
  if (!user) throw notFound("account_not_found", "No account with this id or email.", input.uid ? "uid" : "email");
  return user;
}

const NOT_FOR_STAFF = "This account is staff: its access is changed in the app only (Admin > Access).";
const assertNotStaff = (user: User | undefined) => {
  if (user?.roles.includes("staff")) throw forbidden("staff_account", NOT_FOR_STAFF);
};

export const InviteAccountInput = z.object({ email: z.email(), ...AccessFields }).strict();

export const inviteAccount: Operation<typeof InviteAccountInput> = {
  name: "invite_account",
  input: InviteAccountInput,
  allowed: staffOnly,
  async plan(tx, caller, input) {
    const email = input.email.trim().toLowerCase();
    const access = parseAccess(input);
    const existing = await getAuth()
      .getUserByEmail(email)
      .catch(() => null);
    if (existing) assertNotStaff(await readDoc<User>(tx, docPaths.user(existing.uid)));
    return effectPlan({ email, access, account: existing ? "exists: its access is replaced" : "created (they sign in with Google or set a password)" }, [COL.users], () => invite(caller, email, access));
  },
};

export const SetAccountAccessInput = z.object({ ...AccountTarget, ...AccessFields }).strict();

export const setAccountAccess: Operation<typeof SetAccountAccessInput> = {
  name: "set_account_access",
  input: SetAccountAccessInput,
  allowed: staffOnly,
  async plan(tx, caller, input) {
    const access = parseAccess(input);
    const auth = await accountOf(input);
    const user = await readDoc<User>(tx, docPaths.user(auth.uid));
    assertNotStaff(user);
    const before = { roles: user?.roles ?? [], investorAccess: user?.investorAccess ?? null };
    const isSame = JSON.stringify(before) === JSON.stringify(access);
    return effectPlan({ account: auth.email ?? auth.uid, from: before, to: access }, [docPaths.user(auth.uid)], () => setAccess(caller, auth.uid, access).then(() => ({ uid: auth.uid })), !isSame);
  },
};

export const SetAccountDisabledInput = z
  .object({ ...AccountTarget, disabled: z.boolean().describe("true: block sign-in (open sessions end within the hour). false: allow it again.") })
  .strict();

export const setAccountDisabled: Operation<typeof SetAccountDisabledInput> = {
  name: "set_account_disabled",
  input: SetAccountDisabledInput,
  allowed: staffOnly,
  async plan(tx, caller, input) {
    const auth = await accountOf(input);
    assertNotStaff(await readDoc<User>(tx, docPaths.user(auth.uid)));
    const { disabled } = input;
    return effectPlan({ account: auth.email ?? auth.uid, disabled }, [docPaths.user(auth.uid)], () => setDisabled(caller, auth.uid, disabled).then(() => ({ uid: auth.uid, disabled })), auth.disabled !== disabled);
  },
};

export const CreateSetPasswordLinkInput = z.object(AccountTarget).strict();

/** Admin > Access : le lien a envoyer a un compte invite qui ne s'est jamais connecte (il choisit son mot de passe). */
export const createSetPasswordLinkAction: Operation<typeof CreateSetPasswordLinkInput> = {
  name: "create_set_password_link",
  input: CreateSetPasswordLinkInput,
  allowed: staffOnly,
  async plan(tx, caller, input) {
    const auth = await accountOf(input);
    assertNotStaff(await readDoc<User>(tx, docPaths.user(auth.uid)));
    return effectPlan(
      { account: auth.email ?? auth.uid, does: "creates a one-time link where they choose their password (only for an account that never signed in); send it to them yourself" },
      [docPaths.user(auth.uid)],
      () => createSetPasswordLink(caller.uid, auth.uid).then((link) => ({ uid: auth.uid, link })),
    );
  },
};

export const BatchIdInput = z.object({ batchId: z.string().min(1) }).strict();

export const syncCalendar: Operation<typeof BatchIdInput> = {
  name: "sync_calendar",
  input: BatchIdInput,
  allowed: staffOnly,
  async plan(tx, caller, { batchId }) {
    const batch = await mustRead<Batch>(tx, docPaths.batch(batchId), "batch", "batchId");
    if (!batch.settings.googleCalendarId) throw badRequest("no_calendar", "This batch is not linked to a Google Calendar (`update_batch` with `googleCalendarId`).", "batchId");
    // La synchro trace ce qu'elle ecrit ; rien ne change, rien n'est trace.
    return effectPlan(
      { batch: batch.name, does: "reads the Google Calendar's changes and applies them to the batch's events (created, moved, renamed, archived)" },
      [COL.events],
      () => syncBatchCalendar(batchId, { actorUid: caller }),
    );
  },
};

export const recomputeScores: Operation<typeof BatchIdInput> = {
  name: "recompute_scores",
  input: BatchIdInput,
  allowed: staffOnly,
  async plan(tx, _caller, { batchId }) {
    const batch = await mustRead<Batch>(tx, docPaths.batch(batchId), "batch", "batchId");
    if (batch.settings.scoresSource === "imported") throw badRequest("imported_scores", "This batch's scores were imported: they are never recomputed.", "batchId");
    return {
      preview: { batch: batch.name, does: "recomputes every founder and startup score of the batch from its current data (also done every night)" },
      targetPaths: [COL.scores],
      effect: () => recomputeBatchScores(batchId),
    };
  },
};
