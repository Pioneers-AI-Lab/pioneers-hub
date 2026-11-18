"use client";

import Link from "next/link";
import { Anchor, Button, Divider, Stack, Text } from "@mantine/core";
import { IconBrandSlack } from "@tabler/icons-react";
import { slackWorkspaceUrl } from "@shared/slackLinks";
import { startupWeightingHint } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useCohort } from "@/context/CohortContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { PROFILE_CATEGORY_LABEL, formatDay, formatScore, percent, todayDayString } from "@/lib/format";
import { canSeeScoreDetails, canSeeStartupsTab } from "@shared/access";
import { SHOW_MILESTONES } from "@/lib/features";
import { paths } from "@/lib/paths";
import { LinkRow, Row, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import { ChartCard } from "@/components/charts/ChartCard";
import { NationalityMap } from "@/components/charts/NationalityMap";
import { ProfileDonut } from "@/components/charts/ProfileDonut";
import { RankedBars } from "@/components/charts/RankedBars";
import { NextSession } from "@/components/event/NextSession";

// ----------------------------
// Accueil du batch
// ----------------------------
// Dans l'ordre : la prochaine seance (« Next session », le prochain evenement
// quel qu'il soit, « See all » vers l'onglet Calendar), la vue d'ensemble du
// batch (« Batch overview », pour tous : `batchStats` est public ; effectif,
// experience, profils, competences, nationalites), les meilleurs fondateurs et
// startups (qui voit les scores, `settings.scoresVisibility`), les resultats. Les prochains
// evenements et « Add to calendar » vivent sur la page Calendar ; la tuile Startups suit
// `settings.startupsVisibility` (Admin > Batch settings), les jalons sont masques (lib/features.ts).
export default function BatchHomePage() {
  const { program } = useProgram();
  const { batch, role, isSignedIn } = useBatch();
  const { founders } = useFounders();
  const { startups } = useStartups();
  const { stats, canSeeScores, founderPerformance, startupScoreOf, founderScaleOf, startupScaleOf } = useCohort();

  const today = todayDayString();
  // Espace Slack du batch, pas un canal (le canal configure peut etre reserve au
  // staff) : pour ceux qui en font partie, pas un visiteur public.
  const slackTeamId = batch.settings.slackTeamId ?? null;
  const slackWorkspace = role !== "public" && slackTeamId ? slackWorkspaceUrl(slackTeamId) : null;

  const topFounders = canSeeScores
    ? founders
        .map((f) => ({ f, score: founderPerformance(f.id) }))
        .filter((x) => x.score !== null)
        .sort((a, b) => b.score! - a.score!)
        .slice(0, 5)
    : [];
  const topStartups = canSeeScores
    ? startups
        .map((s) => ({ s, score: startupScoreOf(s.id) }))
        .filter((x) => x.score !== null)
        .sort((a, b) => b.score! - a.score!)
        .slice(0, 5)
    : [];

  // Visiteur public : ce qu'il manque, sous le titre de la vue d'ensemble (pas au milieu de ses cartes).
  const publicHint =
    role === "public" ? (
      <>
        {isSignedIn ? (
          // Connecte sans profil dans ce batch : se connecter n'y changerait rien.
          <>
            Your account is not linked to a founder profile of this batch.{" "}
            <Anchor component={Link} href={paths.claim()} inherit>
              Find your profile
            </Anchor>
          </>
        ) : (
          <>
            Founders of this batch:{" "}
            <Anchor component={Link} href={paths.signIn(paths.batch(program.id, batch.id))} inherit>
              sign in
            </Anchor>
          </>
        )}{" "}
        to see everyone.
      </>
    ) : undefined;

  return (
    <Stack gap={0}>
      {slackWorkspace && (
        <Button
          component="a"
          href={slackWorkspace}
          target="_blank"
          rel="noreferrer"
          variant="default"
          size="sm"
          radius="xl"
          w="fit-content"
          leftSection={<IconBrandSlack size={16} stroke={1.75} />}
        >
          Slack
        </Button>
      )}

      <NextSession />

      <Section title="Batch overview" hint={publicHint}>
        <StatGrid>
          <StatTile label="Founders" value={stats?.founders ?? founders.length} href={paths.founders(program.id, batch.id)} />
          {stats && <StatTile label="Nationalities" value={Object.keys(stats.nationalities).length} />}
          {canSeeStartupsTab(role, batch.settings) && <StatTile label="Startups" value={startups.length} href={paths.startups(program.id, batch.id)} />}
          {stats?.avgYearsOfXP !== null && stats?.avgYearsOfXP !== undefined && (
            <StatTile label="Avg years of XP" value={stats.avgYearsOfXP.toFixed(1)} />
          )}
          {stats?.repeatFounders !== null && stats?.repeatFounders !== undefined && (
            <StatTile label="Repeat founders" value={percent(stats.repeatFounders)} />
          )}
        </StatGrid>


        {stats && (
          <>
            <ChartCard title="Profile distribution">
              <ProfileDonut
                slices={(["technical", "business", "hybrid"] as const).map((k) => ({
                  key: k,
                  label: PROFILE_CATEGORY_LABEL[k],
                  value: stats.profileDistribution[k] ?? 0,
                }))}
              />
              <Divider color="dark.4" />
              <RankedBars
                bars={Object.entries(stats.skillsDistribution).map(([k, v]) => ({ key: k, label: k, value: v }))}
                limit={6}
              />
            </ChartCard>
            <ChartCard title="Nationalities">
              <NationalityMap counts={stats.nationalities} />
            </ChartCard>
          </>
        )}
      </Section>

      {topFounders.length > 0 && (
        <Section title="Top founders" help={`Program performance, out of ${founderScaleOf(topFounders[0].f.id)}.`}>
          <RowList>
            {topFounders.map(({ f, score }) => (
              <LinkRow
                key={f.id}
                href={paths.founder(program.id, batch.id, f.id)}
                avatar={{ name: f.name, photoUrl: f.photoUrl }}
                title={f.name}
                subtitle={f.trackRecordOneLiner ?? undefined}
                meta={<Text fw={600} className="num">{formatScore(score, founderScaleOf(f.id))}</Text>}
              />
            ))}
          </RowList>
        </Section>
      )}

      {topStartups.length > 0 && (
        <Section
          title="Top startups"
          help={
            canSeeScoreDetails(role)
              ? `${startupWeightingHint({ scale: startupScaleOf(topStartups[0].s.id) })}.`
              : `Startup score, out of ${startupScaleOf(topStartups[0].s.id)}.`
          }
        >
          <RowList>
            {topStartups.map(({ s, score }) => (
              <LinkRow
                key={s.id}
                href={paths.startup(program.id, batch.id, s.id)}
                avatar={{ name: s.name, photoUrl: s.logoUrl }}
                title={s.name}
                subtitle={s.ideaOneLine ?? undefined}
                meta={<Text fw={600} className="num">{formatScore(score, startupScaleOf(s.id))}</Text>}
              />
            ))}
          </RowList>
        </Section>
      )}

      <Section title="Results">
        <RowList>
          <LinkRow href={paths.leaderboard(program.id, batch.id)} title="Leaderboard" subtitle="Jury scores by event" />
        </RowList>
      </Section>

      {SHOW_MILESTONES && (
        <Section title="Milestones">
          <RowList>
            {batch.milestones
              .filter((m) => m.dayString || batch.status !== "completed")
              .map((m) => (
                <Row
                  key={m.key}
                  title={m.label}
                  meta={
                    <Text size="sm" c={!m.dayString || m.dayString < today ? "dimmed" : undefined} className={m.dayString ? "num" : undefined}>
                      {m.dayString ? formatDay(m.dayString) : "To be set"}
                    </Text>
                  }
                />
              ))}
          </RowList>
        </Section>
      )}
    </Stack>
  );
}
