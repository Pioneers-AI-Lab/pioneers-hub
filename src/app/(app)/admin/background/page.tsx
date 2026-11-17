"use client";

import { BACKGROUND_CRITERIA, BACKGROUND_OUTSTANDING_BONUS, backgroundScore, isBackgroundRated, ratedBackgroundScore } from "@shared/background";
import { useAdminBackground, type BackgroundRow } from "@/context/AdminBackgroundContext";
import { paths } from "@/lib/paths";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { backgroundFacts } from "@/lib/backgroundAdmin";

// ----------------------------
// Admin > Background : la grille Background de chaque fondateur du batch (lot 2)
// ----------------------------
// Notee une fois par le staff, sur le profil (shared/background.ts). Une note proposee
// par Claude (scripts/background-draft.mjs) pre-remplit la grille : elle ne compte
// qu'une fois enregistree par le staff. A noter d'abord, puis les notes, de la meilleure.

const GRID_HINT = `${BACKGROUND_CRITERIA.map((c) => `${c.label} ${c.points}`).join(" · ")}. Outstanding +${BACKGROUND_OUTSTANDING_BONUS}, only at 100.`;

/** La note proposee, a afficher a droite d'un fondateur a noter. */
const proposedMeta = (row: BackgroundRow) => {
  const proposed = row.background?.proposed;
  const score = proposed ? backgroundScore(proposed.scores, proposed.outstanding) : null;
  return score === null ? undefined : `Proposed ${score}`;
};

export default function AdminBackgroundPage() {
  const { rows, isLoading } = useAdminBackground();
  if (isLoading) return <PageLoader />;

  const toRate = rows.filter((r) => !isBackgroundRated(r.background));
  const rated = rows
    .filter((r) => isBackgroundRated(r.background))
    .map((r) => ({ row: r, score: ratedBackgroundScore(r.background) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.row.founder.name.localeCompare(b.row.founder.name));

  const row = (r: BackgroundRow, meta: string | undefined) => (
    <LinkRow
      key={r.founder.id}
      href={paths.adminBackgroundFounder(r.founder.id)}
      avatar={{ name: r.founder.name, photoUrl: r.founder.photoUrl }}
      title={r.founder.name}
      subtitle={backgroundFacts(r.directory) || "Profile mostly empty"}
      meta={meta}
    />
  );

  return (
    <>
      <PageHeader back={{ href: paths.admin(), label: "Admin" }} title="Background" help="Rate each founder's profile once, at onboarding. Staff and IC investors see it." />
      <BatchPicker />

      <Section title={`To rate · ${toRate.length}`} help={GRID_HINT}>
        {toRate.length === 0 ? <Empty>Every founder is rated.</Empty> : <RowList>{toRate.map((r) => row(r, proposedMeta(r)))}</RowList>}
      </Section>

      <Section title={`Rated · ${rated.length}`} help="Best first. Out of 100, 120 with the Outstanding mention.">
        {rated.length === 0 ? <Empty>No founder rated yet.</Empty> : <RowList>{rated.map(({ row: r, score }) => row(r, String(score)))}</RowList>}
      </Section>
    </>
  );
}
