import { randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { calendarIdOf, isMovedBy, planCalendarSync, syncedCalendarIdOf, type CalendarSyncPlan, type GoogleCalendarEvent } from "../shared/calendarSync";
import { FUNCTIONS_REGION } from "../shared/callables";
import { COL, docPaths } from "../shared/collections";
import { formsClosedByArchive, planEventMove } from "../shared/eventForms";
import type { Batch, CalendarChannel, CalendarSync, CalendarSyncCounts, CalendarSyncResult, Form, PioneersEvent, WithId } from "../shared/types";
import { secret, sha256 } from "../api/crypto";
import { writeAudit } from "./audit";

// ----------------------------
// services - la synchro de l'agenda Google d'un batch (decision du 16/11)
// ----------------------------
// A chaque changement de l'agenda (notification de Google sur
// `googleCalendarWebhook`), toutes les 30 minutes en filet (`syncGoogleCalendars`,
// index.ts) et sur le bouton du staff (`syncBatchCalendar`) : lit les changements
// de l'agenda depuis la derniere fois (`syncToken`, stocke dans
// `calendarSyncs/{batchId}`), les traduit (shared/calendarSync.ts) et les ecrit
// avec l'Admin SDK. Le jeton expire (410) : synchro complete.
//
// Notifications (`events.watch`) : un abonnement par batch, pris a la premiere
// synchro reussie et renouvele un jour avant d'expirer (Google le donne pour 7
// jours au plus, sans renouvellement automatique). La notification ne porte
// rien : elle declenche la meme synchro. Elle n'est acceptee qu'avec le secret
// de l'abonnement (`X-Goog-Channel-Token`).
//
// Acces : l'agenda est partage, en lecture, avec le compte de service des
// functions (identifiants par defaut, sans cle). L'API Google Calendar doit
// etre activee dans le projet. Aux emulateurs, l'agenda est un document
// `calendarFakes/{calendarId}` ({ events }) ecrit par les verifications : il
// rend tout l'agenda a chaque fois (synchro complete).

const db = () => getFirestore();

class SyncTokenExpired extends Error {}

type Changes = { items: GoogleCalendarEvent[]; nextSyncToken: string | null; isFull: boolean };

/** Un canal a ouvrir : le secret en clair part chez Google, le Hub n'en garde que l'empreinte. */
type NewChannel = Pick<CalendarChannel, "id" | "calendarId"> & { token: string };

/** Ou lire l'agenda : Google, ou le faux agenda des emulateurs. Choisi une fois. */
type CalendarReader = {
  /** Les changements depuis `syncToken` (`null` : tout l'agenda). */
  listChanges: (calendarId: string, syncToken: string | null) => Promise<Changes>;
  /** L'adresse avec laquelle partager l'agenda (Google Calendar > Share with specific people). */
  accountEmail: () => Promise<string>;
  /** S'abonne aux changements de l'agenda : Google appellera `address`. */
  watch: (channel: NewChannel, address: string) => Promise<Pick<CalendarChannel, "resourceId" | "expirationDateISOString">>;
  /** Arrete un abonnement (remplace, ou batch delie). */
  stop: (channel: Pick<CalendarChannel, "id" | "resourceId">) => Promise<void>;
};

/** Duree demandee d'un abonnement (Google peut la raccourcir) et marge de renouvellement. */
const CHANNEL_TTL_SECONDS = 7 * 24 * 3600;
const RENEW_BEFORE_MS = 24 * 3600 * 1000;
const defaultExpiry = () => new Date(Date.now() + CHANNEL_TTL_SECONDS * 1000).toISOString();

/** Ou Google envoie les notifications : la fonction `googleCalendarWebhook` (index.ts). */
const webhookAddress = () => {
  const project = process.env.GCLOUD_PROJECT;
  return process.env.FUNCTIONS_EMULATOR === "true"
    ? `http://${process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5101"}/${project}/${FUNCTIONS_REGION}/googleCalendarWebhook`
    : `https://${FUNCTIONS_REGION}-${project}.cloudfunctions.net/googleCalendarWebhook`;
};

type GoogleError = { status?: number; response?: { status?: number }; message?: string };
const statusOf = (err: GoogleError) => err.status ?? err.response?.status;

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
          .catch(async (err: GoogleError) => {
            const status = statusOf(err);
            if (status === 410) throw new SyncTokenExpired();
            if (status === 404 || status === 403) throw await notShared(calendarId);
            throw new HttpsError("unavailable", `Google Calendar: ${err.message ?? "request failed"}`);
          });
        items.push(...(res.data.items ?? []));
        if (res.data.nextPageToken) pageToken = res.data.nextPageToken;
        else return { items, nextSyncToken: res.data.nextSyncToken ?? null, isFull: !syncToken };
      }
    },
    async watch(channel, address) {
      const res = await client()
        .request<{ resourceId: string; expiration?: string }>({
          url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(channel.calendarId)}/events/watch`,
          method: "POST",
          data: { id: channel.id, type: "web_hook", address, token: channel.token, params: { ttl: String(CHANNEL_TTL_SECONDS) } },
        })
        .catch((err: GoogleError) => Promise.reject(new Error(`Google Calendar refused the subscription (${statusOf(err) ?? "?"}): ${err.message ?? "request failed"}`)));
      const expiration = Number(res.data.expiration);
      return { resourceId: res.data.resourceId, expirationDateISOString: expiration ? new Date(expiration).toISOString() : defaultExpiry() };
    },
    async stop(channel) {
      await client().request({ url: "https://www.googleapis.com/calendar/v3/channels/stop", method: "POST", data: { id: channel.id, resourceId: channel.resourceId } });
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
  // Rien n'appelle le webhook aux emulateurs : les verifications le font a la main, avec le
  // secret que le faux agenda garde (comme Google, le seul a l'avoir en clair).
  async watch(channel) {
    await db().collection(COL.calendarFakes).doc(encodeURIComponent(channel.calendarId)).set({ channel: { id: channel.id, token: channel.token } }, { merge: true });
    return { resourceId: `fake-${channel.id}`, expirationDateISOString: defaultExpiry() };
  },
  stop: async () => {},
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
    const [, subscription] = await Promise.all([
      writePlan(plan, moves, forms, now, batchId, calendarId, options.actorUid),
      subscribe(batchId, calendarId, state?.channel ?? null),
    ]);
    const next: CalendarSync = {
      batchId,
      calendarId,
      syncToken: changes.nextSyncToken,
      lastSyncDateISOString: now,
      lastSuccessDateISOString: now,
      lastError: null,
      counts,
      ...subscription,
    };
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

/**
 * L'abonnement du batch a son agenda : garde tant qu'il suit le bon agenda et
 * n'expire pas dans la journee, sinon remplace (l'ancien est arrete). Un refus
 * de Google n'arrete pas la synchro : il est note (`channelError`), la tache
 * planifiee reessaie.
 */
async function subscribe(batchId: string, calendarId: string, current: CalendarChannel | null): Promise<Pick<CalendarSync, "channel" | "channelError">> {
  /** Le canal actuel suit cet agenda et dure encore au moins `ms`. */
  const lastsFor = (ms: number) => current?.calendarId === calendarId && Date.parse(current.expirationDateISOString) - Date.now() > ms;
  if (lastsFor(RENEW_BEFORE_MS)) return { channel: current, channelError: null };
  const channel: NewChannel = { id: `${batchId.slice(0, 27)}-${randomUUID()}`, token: secret(), calendarId };
  try {
    const taken = await source.watch(channel, webhookAddress());
    if (current) await source.stop(current).catch(() => {}); // il expire de lui-meme sinon
    return { channel: { id: channel.id, calendarId, tokenHash: sha256(channel.token), ...taken }, channelError: null };
  } catch (err) {
    return { channel: lastsFor(0) ? current : null, channelError: (err as Error).message };
  }
}

/**
 * Une notification de Google (`googleCalendarWebhook`) : le code HTTP a rendre.
 * `sync` (la premiere, a l'abonnement, parfois avant que l'etat soit ecrit) :
 * rien a faire. Un canal inconnu (remplace, ou pris deux fois par deux synchros
 * simultanees) : arrete. Un mauvais secret : refuse. Un batch delie de cet
 * agenda, archive ou termine (`syncedCalendarIdOf`, la regle de la tache
 * planifiee) : le canal est arrete.
 * Sinon la synchro du batch tourne avant la reponse (une fonction n'a plus de
 * processeur apres) ; son echec est note dans l'etat, la reponse reste 200 :
 * la tache planifiee rattrapera, Google n'a pas a reessayer.
 */
export async function handleCalendarNotification(headers: { channelId?: string; resourceId?: string; token?: string; state?: string }): Promise<number> {
  if (!headers.channelId) return 400;
  if (headers.state === "sync") return 200;
  const snap = await db().collection(COL.calendarSyncs).where("channel.id", "==", headers.channelId).limit(1).get();
  const state = snap.docs[0]?.data() as CalendarSync | undefined;
  const channel = state?.channel;
  if (!state || !channel) {
    if (headers.resourceId) await source.stop({ id: headers.channelId, resourceId: headers.resourceId }).catch(() => {});
    return 200;
  }
  if (!headers.token || sha256(headers.token) !== channel.tokenHash) return 403;

  const batch = (await db().doc(docPaths.batch(state.batchId)).get()).data() as Batch | undefined;
  if (!batch || syncedCalendarIdOf(batch) !== channel.calendarId) {
    await source.stop(channel).catch(() => {});
    await snap.docs[0].ref.set({ channel: null }, { merge: true });
    return 200;
  }
  await syncBatchCalendar(state.batchId, { actorUid: null }).catch((err: Error) => console.error("googleCalendarWebhook", state.batchId, err.message));
  return 200;
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
  const linked = batches.docs.filter((s) => syncedCalendarIdOf(s.data() as Batch) !== null);
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
