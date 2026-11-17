"use client";

import { useAdminReviews } from "@/context/AdminReviewsContext";
import { useParamsTS } from "@/hooks/useParamsTS";
import { paths } from "@/lib/paths";
import { founderReviewSummary, nextReviewHref, startupReviewMeta, weekLabel } from "@/lib/reviewsAdmin";
import { ActionBar } from "@/components/admin/ActionBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Admin > Reviews > une semaine : chaque Weekly update, revu ou a revoir (lot 4)
// ----------------------------
// Les fondateurs, puis les startups, par nom. « Start reviewing » ouvre le premier a revoir ;
// chaque enregistrement passe au suivant (`nextReviewHref`).

export default function AdminReviewsWeekPage() {
  const { week } = useParamsTS<{ week: string }>();
  const { rowsOf, isLoading } = useAdminReviews();
  if (isLoading) return <PageLoader />;
  const rows = rowsOf(week);
  const { founders, startups, toReview } = rows;

  return (
    <>
      <PageHeader back={{ href: paths.adminReviews(), label: "Reviews" }} title={weekLabel(week)} subtitle={toReview > 0 ? `${toReview} to review` : "Every update is reviewed."} />

      <Section title={`Founder updates · ${founders.length}`}>
        {founders.length === 0 ? (
          <Empty>No founder update this week.</Empty>
        ) : (
          <RowList>
            {founders.map((r) => (
              <LinkRow
                key={r.founder.id}
                href={paths.adminReviewFounder(week, r.founder.id)}
                avatar={{ name: r.founder.name, photoUrl: r.founder.photoUrl }}
                title={r.founder.name}
                subtitle={founderReviewSummary(r.review) || "To review"}
              />
            ))}
          </RowList>
        )}
      </Section>

      <Section title={`Startup updates · ${startups.length}`} help="Out of 100, 120 with the Outstanding mention.">
        {startups.length === 0 ? (
          <Empty>No startup update this week.</Empty>
        ) : (
          <RowList>
            {startups.map((r) => (
              <LinkRow
                key={r.startup.id}
                href={paths.adminReviewStartup(week, r.startup.id)}
                avatar={{ name: r.startup.name, photoUrl: r.startup.logoUrl }}
                title={r.startup.name}
                subtitle={r.review ? "Reviewed" : "To review"}
                meta={startupReviewMeta(r)}
              />
            ))}
          </RowList>
        )}
      </Section>

      {toReview > 0 && <ActionBar label="Start reviewing" href={nextReviewHref(week, rows, {})} />}
    </>
  );
}
