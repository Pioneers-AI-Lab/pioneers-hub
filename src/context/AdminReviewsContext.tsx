"use client";

import { useMemo, type ReactNode } from "react";
import { parisMonday, shiftWeek } from "@shared/dates";
import { reciprocalMetCount } from "@shared/scoring";
import {
  isBatchParticipant,
  readConnections,
  type Checkin,
  type Founder,
  type FounderReview,
  type FounderWeek,
  type Startup,
  type StartupReview,
  type WithId,
} from "@shared/types";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocsListener, useQueryListener } from "@/hooks/useFirestoreListener";
import { useAdmin } from "@/context/AdminContext";

// ----------------------------
// Admin > Reviews : les Weekly updates du batch de travail et leurs revues (lot 4)
// ----------------------------
// Monte par admin/reviews/layout.tsx. Les updates sont les documents types que les formulaires
// ecrivent : `founderWeeks` (Weekly update founder) et `checkins` (Weekly update startup), par
// semaine (le lundi de la semaine ou le formulaire ouvre). A cote : la revue de chacun
// (`founderReviews`, `startupReviews`, staff + IC) et, pour un fondateur, sa shortlist et ses
// « Met » (`private/connections`, lisibles du staff) : le jure ne les redemande pas.
// Tout est regroupe une fois par semaine (et par startup) ; les lignes d'une semaine se
// construisent a la premiere lecture, puis restent en cache jusqu'au prochain changement.

export type FounderReviewRow = {
  founder: WithId<Founder>;
  update: WithId<FounderWeek>;
  /** L'objectif qu'il avait donne la semaine d'avant (`goalForWeek`), a juger « atteint ? ». */
  previousGoal: string | null;
  review: WithId<FounderReview> | null;
  shortlistedCount: number;
  metCount: number;
  /** « Met » reciproques (milestone Met). */
  reciprocalMetCount: number;
};

export type StartupReviewRow = {
  startup: WithId<Startup>;
  /** Ses updates de la semaine : une par membre qui l'a envoyee (normalement une). La plus recente d'abord. */
  updates: WithId<Checkin>[];
  /** Ses objectifs de la semaine d'avant (`checkin.goals`), a juger « Progress ». */
  previousGoals: string | null;
  review: WithId<StartupReview> | null;
};

export type WeekRows = { founders: FounderReviewRow[]; startups: StartupReviewRow[]; toReview: number };

export type ReviewWeek = { week: string; founders: number; startups: number; toReview: number };

type AdminReviewsValue = {
  /** Les semaines avec des updates, la plus recente d'abord (la semaine en cours toujours). */
  weeks: ReviewWeek[];
  /** Les updates d'une semaine, par nom : fondateurs, puis startups. */
  rowsOf: (week: string) => WeekRows;
  isLoading: boolean;
};

const [AdminReviewsContextProvider, useAdminReviews] = createStrictContext<AdminReviewsValue>("AdminReviews");
export { useAdminReviews };

/** Un texte non vide, ou `null`. */
const textOrNull = (v: string | null | undefined) => v?.trim() || null;

/** Range une liste par cle. */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

const NO_ROWS: WeekRows = { founders: [], startups: [], toReview: 0 };

export function AdminReviewsProvider({ children }: { children: ReactNode }) {
  const { batch, founders, startups, isLoading: isAdminLoading } = useAdmin();
  const participants = useMemo(() => founders.filter((f) => isBatchParticipant(f, batch.id)), [founders, batch.id]);
  const { data: allUpdates, isLoading: updatesLoading } = useQueryListener(queries.founderWeeksOfBatch(batch.id));
  const { data: allCheckins, isLoading: checkinsLoading } = useQueryListener(queries.checkinsOfBatch(batch.id));
  const { data: founderReviews, isLoading: founderReviewsLoading } = useQueryListener(queries.founderReviewsOfBatch(batch.id));
  const { data: startupReviews, isLoading: startupReviewsLoading } = useQueryListener(queries.startupReviewsOfBatch(batch.id));
  const { data: connections, isLoading: connectionsLoading } = useDocsListener(
    useMemo(() => participants.map((f) => [f.id, refs.founderConnections(f.id)] as const), [participants]),
  );
  const isLoading = isAdminLoading || updatesLoading || checkinsLoading || founderReviewsLoading || startupReviewsLoading || connectionsLoading;

  const value = useMemo<AdminReviewsValue>(() => {
    if (isLoading) return { weeks: [], rowsOf: () => NO_ROWS, isLoading };
    const founderById = new Map(participants.map((f) => [f.id, f]));
    const startupById = new Map(startups.map((s) => [s.id, s]));
    const updatesByWeek = groupBy(
      allUpdates.filter((w) => founderById.has(w.founderId)),
      (w) => w.weekStartDayString,
    );
    const checkins = allCheckins
      .filter((c) => startupById.has(c.startupId))
      .sort((a, b) => b.updatedDateISOString.localeCompare(a.updatedDateISOString));
    const checkinsOf = groupBy(checkins, (c) => `${c.startupId}_${c.weekStartDayString}`);
    const startupIdsByWeek = new Map(
      [...groupBy(checkins, (c) => c.weekStartDayString)].map(([week, list]) => [week, [...new Set(list.map((c) => c.startupId))]]),
    );
    const goalOf = new Map(allUpdates.map((w) => [`${w.founderId}_${w.weekStartDayString}`, textOrNull(w.goalForWeek)]));
    const founderReviewOf = new Map(founderReviews.map((r) => [`${r.founderId}_${r.weekStartDayString}`, r]));
    const startupReviewOf = new Map(startupReviews.map((r) => [`${r.startupId}_${r.weekStartDayString}`, r]));

    // Le reseau de chaque fondateur, une fois (il ne depend pas de la semaine).
    const lists = new Map(participants.map((f) => [f.id, readConnections(connections.get(f.id) ?? null)]));
    const metOf = new Map([...lists].map(([id, l]) => [id, new Set(l.metFounderIds)]));
    const network = new Map(
      [...lists].map(([id, l]) => [
        id,
        { shortlistedCount: l.shortlistedFounderIds.length, metCount: l.metFounderIds.length, reciprocalMetCount: reciprocalMetCount(id, metOf) },
      ]),
    );

    const cache = new Map<string, WeekRows>();
    const rowsOf = (week: string): WeekRows => {
      const cached = cache.get(week);
      if (cached) return cached;
      const founderRows = (updatesByWeek.get(week) ?? [])
        .map((update) => ({
          founder: founderById.get(update.founderId)!,
          update,
          previousGoal: goalOf.get(`${update.founderId}_${shiftWeek(week, -1)}`) ?? null,
          review: founderReviewOf.get(`${update.founderId}_${week}`) ?? null,
          ...network.get(update.founderId)!,
        }))
        .sort((a, b) => a.founder.name.localeCompare(b.founder.name));
      const startupRows = (startupIdsByWeek.get(week) ?? [])
        .map((startupId) => ({
          startup: startupById.get(startupId)!,
          updates: checkinsOf.get(`${startupId}_${week}`) ?? [],
          previousGoals: (checkinsOf.get(`${startupId}_${shiftWeek(week, -1)}`) ?? []).map((c) => textOrNull(c.goals)).find(Boolean) ?? null,
          review: startupReviewOf.get(`${startupId}_${week}`) ?? null,
        }))
        .sort((a, b) => a.startup.name.localeCompare(b.startup.name));
      const rows = {
        founders: founderRows,
        startups: startupRows,
        toReview: founderRows.filter((r) => !r.review).length + startupRows.filter((r) => !r.review).length,
      };
      cache.set(week, rows);
      return rows;
    };

    // Les semaines : des comptes, sans construire les lignes.
    const current = parisMonday(new Date().toISOString());
    const weeks = [...new Set([current, ...updatesByWeek.keys(), ...startupIdsByWeek.keys()])]
      .sort()
      .reverse()
      .map((week) => {
        const founderIds = (updatesByWeek.get(week) ?? []).map((u) => u.founderId);
        const startupIds = startupIdsByWeek.get(week) ?? [];
        const toReview =
          founderIds.filter((id) => !founderReviewOf.has(`${id}_${week}`)).length + startupIds.filter((id) => !startupReviewOf.has(`${id}_${week}`)).length;
        return { week, founders: founderIds.length, startups: startupIds.length, toReview };
      });

    return { weeks, rowsOf, isLoading };
  }, [participants, startups, allUpdates, allCheckins, founderReviews, startupReviews, connections, isLoading]);

  return <AdminReviewsContextProvider value={value}>{children}</AdminReviewsContextProvider>;
}
