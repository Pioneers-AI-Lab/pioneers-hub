"use client";

import { useAdminReviews } from "@/context/AdminReviewsContext";
import { paths } from "@/lib/paths";
import { weekLabel } from "@/lib/reviewsAdmin";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";

// ----------------------------
// Admin > Reviews : la file de revue des Weekly updates, par semaine (lot 4)
// ----------------------------
// Chaque semaine : les Weekly updates founder (grille oui / non) et startup (Traction, Progress),
// a revoir l'un apres l'autre (shared/weeklyReviews.ts). La semaine en cours d'abord.

export default function AdminReviewsPage() {
  const { weeks, isLoading } = useAdminReviews();
  if (isLoading) return <PageLoader />;
  return (
    <>
      <PageHeader
        back={{ href: paths.admin(), label: "Admin" }}
        title="Reviews"
        help="Review each weekly update, one after the other. Staff and IC investors see the reviews; founders never do."
      />
      <BatchPicker />
      <Section
        title="Weeks"
        help="Founder updates: yes or no on the goal and the problem, which give the Weekly goal and Problem validated milestones. Startup updates: Traction (60 points) and Progress (40), Outstanding +20 only at 100, which give the startup's Traction."
      >
        <RowList>
          {weeks.map((w) => (
            <LinkRow
              key={w.week}
              href={paths.adminReviewsWeek(w.week)}
              title={weekLabel(w.week)}
              subtitle={`${w.founders} founder update${w.founders === 1 ? "" : "s"} · ${w.startups} startup update${w.startups === 1 ? "" : "s"}`}
              meta={w.toReview > 0 ? `${w.toReview} to review` : w.founders + w.startups > 0 ? "Reviewed" : undefined}
            />
          ))}
        </RowList>
      </Section>
    </>
  );
}
