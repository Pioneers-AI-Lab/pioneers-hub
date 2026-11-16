import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { calendarIdOf, isMovedBy, planCalendarSync, type CalendarSyncPlan, type GoogleCalendarEvent } from "../shared/calendarSync";
import { COL, docPaths } from "../shared/collections";
import { formsClosedByArchive, planEventMove } from "../shared/eventForms";
import type { Batch, CalendarSync, CalendarSyncCounts, CalendarSyncResult, Form, PioneersEvent, WithId } from "../shared/types";
import { writeAudit } from "./audit";

// ----------------------------
// services - la synchro de l'agenda Google d'un batch (decision du 16/11)
// ----------------------------
// Toutes les 5 minutes (`syncGoogleCalendars`, index.ts) et sur le bouton du
// staff (`syncBatchCalendar`) : lit les changements de l'agenda depuis la
// derniere fois (`syncToken`, stocke dans `calendarSyncs/{batchId}`), les
// traduit (shared/calendarSync.ts) et les ecrit avec l'Admin SDK. Le jeton
// expire (410) : synchro complete.
//
// Acces : l'agenda est partage, en lecture, avec le compte de service des
// functions (identifiants par defaut, sans cle). L'API Google Calendar doit
// etre activee dans le projet. Aux emulateurs, l'agenda est un document
// `calendarFakes/{calendarId}` ({ events }) ecrit par les verifications : il
// rend tout l'agenda a chaque fois (synchro complete).

const db = () => getFirestore();

class SyncTokenExpired extends Error {}

type Changes = { items: GoogleCalendarEvent[]; nextSyncToken: string | null; isFull: boolean };

/** Ou lire l'agenda : Google, ou le faux agenda des emulateurs. Choisi une fois. */
type CalendarReader = {
  /** Les changements depuis `syncToken` (`null` : tout l'agenda). */
  listChanges: (calendarId: string, syncToken: string | null) => Promise<Changes>;
  /** L'adresse avec laquelle partager l'agenda (Google Calendar > Share with specific people). */
  accountEmail: () => Promise<string>;
};

const notShared = async (calendarId: string) =>
  new HttpsError("not-found", `Calendar ${calendarId} not found, or not shared with ${await source.accountEmail()} (See all event details).`);

function googleReader(): CalendarReader {
  let auth: GoogleAuth | null = null;
  const client = () => (auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/calendar.readonly"] }));
  let email: Promise<string> | null = null;
  return {
    accountEmail: () => (email ??= client().getCredentials().then((c) => c.client_email ?? "the Hub's service account")),
    async listChanges(calendarId, syncToken) {
      const items: GoogleCalendarEvent[] = [];
      let pageToken: string | undefined;
      for (;;) {
        // `singleEvents` : une occurrence d'un evenement recurrent est un evenement du Hub.
        const params: Record<string, string> = { singleEvents: "true", maxResults: "2500" };
        if (syncToken) params.syncToken = syncToken;
        if (pageToken) params.pageToken = pageToken;
        const res = await client()
          .request<{ items?: GoogleCalendarEvent[]; nextPageToken?: string; nextSyncToken?: string }>({
            url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
            params,
          })
          .catch(async (err: { status?: number; response?: { status?: number }; message?: string }) => {
            const status = err.status ?? err.response?.status;
            if (status === 410) throw new SyncTokenExpired();
            if (status === 404 || status === 403) throw await notShared(calendarId);
            throw new HttpsError("unavailable", `Google Calendar: ${err.message ?? "request failed"}`);
          });
        items.push(...(res.data.items ?? []));
        if (res.data.nextPageToken) pageToken = res.data.nextPageToken;
        else return { items, nextSyncToken: res.data.nextSyncToken ?? null, isFull: !syncToken };
      }
    },
  };
}

const fakeReader: CalendarReader = {
  accountEmail: async () => "emulator@demo-pioneers-hub.iam.gserviceaccount.com",
  async listChanges(calendarId) {
    const fake = await db().collection(COL.calendarFakes).doc(encodeURIComponent(calendarId)).get();
    if (!fake.exists) throw await notShared(calendarId);
    return { items: (fake.data()?.events ?? []) as GoogleCalendarEvent[], nextSyncToken: "fake", isFull: true };
  },
};

const source: CalendarReader = process.env.FUNCTIONS_EMULATOR === "true" ? fakeReader : googleReader();

const docsOf = async <T>(collection: string, batchId: string): Promise<WithId<T>[]> =>
  (await db().collection(collection).where("batchId", "==", batchId).get()).docs.map((d) => ({ ...(d.data() as T), id: d.id }));

/**
 * Synchronise le batch avec son agenda. `dryRun` : rien n'est ecrit (ni le
 * jeton) ; `calendarId` : essayer un agenda avant de l'enregistrer (a blanc
 * seulement). `actorUid` : le staff qui lance (`null` : la tache planifiee).
 */
export async function syncBatchCalendar(
  batchId: string,
  options: { dryRun?: boolean; calendarId?: string | null; actorUid: string | null },
): Promise<CalendarSyncResult> {
  const stateRef = db().doc(docPaths.calendarSync(batchId));
  const [batchSnap, stateSnap] = await Promise.all([db().doc(docPaths.batch(batchId)).get(), stateRef.get()]);
  const batch = batchSnap.data() as Batch | undefined;
  if (!batch) throw new HttpsError("not-found", `Batch ${batchId} does not exist.`);
  const dryRun = options.dryRun === true;
  const saved = calendarIdOf(batch);
  const calendarId = options.calendarId?.trim() || saved;
  if (!calendarId) throw new HttpsError("failed-precondition", "Set the batch's Google Calendar ID first.");
  if (!dryRun && calendarId !== saved) throw new HttpsError("failed-precondition", "Save the calendar ID before syncing it.");

  const state = stateSnap.data() as CalendarSync | undefined;
  const token = !dryRun && state?.calendarId === calendarId ? state.syncToken : null;
  const now = new Date().toISOString();

  let changes: Changes;
  try {
    changes = await source
      .listChanges(calendarId, token)
      .catch((err) => (err instanceof SyncTokenExpired ? source.listChanges(calendarId, null) : Promise.reject(err)));
  } catch (err) {
    if (!dryRun) await stateRef.set({ batchId, calendarId, syncToken: token, lastSyncDateISOString: now, lastError: (err as Error).message }, { merge: true });
    throw err;
  }

  // Rien de neuf (le cas de presque toutes les synchros) : ni lecture du batch, ni ecriture.
  const isQuiet = !changes.isFull && changes.items.length === 0;
  const plan: CalendarSyncPlan = isQuiet
    ? { creates: [], updates: [], archives: [], seen: 0 }
    : await planBatch(batchId, batch, calendarId, changes);
  const forms = isQuiet || (plan.updates.length === 0 && plan.archives.length === 0) ? [] : await docsOf<Form>(COL.forms, batchId);
  const moves = formMoves(plan, forms, now);
  const counts: CalendarSyncCounts = {
    created: plan.creates.length,
    updated: plan.updates.filter((u) => !u.isLink).length,
    linked: plan.updates.filter((u) => u.isLink).length,
    archived: plan.archives.length,
    formsMoved: moves.length,
  };

  if (!dryRun) {
    await writePlan(plan, moves, forms, now, batchId, calendarId, options.actorUid);
    const next: CalendarSync = { batchId, calendarId, syncToken: changes.nextSyncToken, lastSyncDateISOString: now, lastSuccessDateISOString: now, lastError: null, counts };
    await stateRef.set(next);
  }
  return {
    serviceAccountEmail: await source.accountEmail(),
    found: plan.seen,
    counts,
    created: plan.creates.map((c) => c.data.name),
    linked: plan.updates.filter((u) => u.isLink).map((u) => u.event.name),
    archived: plan.archives.map((e) => e.name),
  };
}

/** Le plan, sur les evenements du batch (archives compris : un evenement masque reste relie). */
type BatchPlan = CalendarSyncPlan & { events: WithId<PioneersEvent>[] };

async function planBatch(batchId: string, batch: Batch, calendarId: string, changes: Changes): Promise<BatchPlan> {
  const events = await docsOf<PioneersEvent>(COL.events, batchId);
  return { ...planCalendarSync({ batch: { ...batch, id: batchId }, calendarId, changes: changes.items, isFull: changes.isFull, events }), events };
}

/** Les deplacements de formulaires qu'entrainent les nouveaux horaires (un creneau Debrief de l'agenda suit le sien). */
function formMoves(plan: CalendarSyncPlan | BatchPlan, forms: WithId<Form>[], nowISO: string) {
  const events = "events" in plan ? plan.events : [];
  return plan.updates.filter(isMovedBy).flatMap((u) => {
    const { startDateISOString, endDateISOString } = { ...u.event, ...u.patch };
    return planEventMove({ event: u.event, next: { startDateISOString, endDateISOString }, events, forms, moveLinked: false, nowISO }).moves;
  });
}

type Write = { path: string; data: object; merge: boolean };

/** Ecrit le plan par lots de 400 ecritures (limite Firestore : 500), le premier avec sa ligne d'audit. */
async function writePlan(
  plan: CalendarSyncPlan,
  moves: ReturnType<typeof formMoves>,
  forms: WithId<Form>[],
  now: string,
  batchId: string,
  calendarId: string,
  actorUid: string | null,
): Promise<void> {
  const stamp = { updatedDateISOString: now };
  const archivedIds = new Set(plan.archives.map((e) => e.id));
  const writes: Write[] = [
    ...plan.creates.map((c) => ({ path: docPaths.event(c.id), data: { ...c.data, createdDateISOString: now, ...stamp } satisfies PioneersEvent, merge: false })),
    ...plan.updates.map((u) => ({ path: docPaths.event(u.event.id), data: { ...u.patch, ...stamp }, merge: true })),
    ...moves.map((m) => ({ path: docPaths.form(m.form.id), data: { opensDateISOString: m.opensDateISOString, deadlineDateISOString: m.deadlineDateISOString, ...stamp }, merge: true })),
    // Masquer ferme ses formulaires ouverts (comme Admin > Events).
    ...plan.archives.map((e) => ({ path: docPaths.event(e.id), data: { archivedDateISOString: now, ...stamp }, merge: true })),
    ...formsClosedByArchive(forms.filter((f) => f.eventId !== null && archivedIds.has(f.eventId))).map((f) => ({
      path: docPaths.form(f.id),
      data: { status: "closed", ...stamp },
      merge: true,
    })),
  ];
  if (writes.length === 0) return;

  const actor = { uid: actorUid ?? "system", apiKeyId: null, via: actorUid ? ("ui" as const) : ("function" as const) };
  const payload = { calendarId, created: plan.creates.map((c) => c.id), updated: plan.updates.map((u) => u.event.id), archived: [...archivedIds], formsMoved: moves.length };
  for (let i = 0; i < writes.length; i += 400) {
    const b = db().batch();
    for (const w of writes.slice(i, i + 400)) b.set(db().doc(w.path), w.data, { merge: w.merge });
    if (i === 0) writeAudit(b, actor, { action: "sync_google_calendar", targetPath: docPaths.batch(batchId), payload, idempotencyKey: null });
    await b.commit();
  }
}

/** Tous les batchs relies a un agenda et en cours : la tache planifiee. Une erreur n'arrete pas les autres. */
export async function syncAllCalendars(): Promise<Record<string, CalendarSyncCounts | string>> {
  const batches = await db().collection(COL.batches).where("status", "in", ["upcoming", "active"]).get();
  const linked = batches.docs.filter((s) => {
    const b = s.data() as Batch;
    return b.archivedDateISOString === null && calendarIdOf(b) !== null;
  });
  const results = await Promise.all(
    linked.map((s) =>
      syncBatchCalendar(s.id, { actorUid: null }).then(
        (r) => [s.id, r.counts] as const,
        (err: Error) => [s.id, err.message] as const,
      ),
    ),
  );
  return Object.fromEntries(results);
}
