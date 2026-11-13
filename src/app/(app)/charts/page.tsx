"use client";

import { Divider, SimpleGrid, Stack, Text } from "@mantine/core";
import { integer, money } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { ChartCard, CHART_COLORS } from "@/components/charts/ChartCard";
import { MarketBubbles } from "@/components/charts/MarketBubbles";
import { MetricAreaChart } from "@/components/charts/MetricAreaChart";
import { NationalityMap } from "@/components/charts/NationalityMap";
import { ProfileDonut } from "@/components/charts/ProfileDonut";
import { RangeBar } from "@/components/charts/RangeBar";
import { RankedBars } from "@/components/charts/RankedBars";
import { RatingDots } from "@/components/charts/RatingDots";
import { ScoreBreakdown } from "@/components/charts/ScoreBreakdown";
import { ScoreRadar } from "@/components/charts/ScoreRadar";
import { TrendLine } from "@/components/charts/TrendLine";

// ----------------------------
// Galerie des graphiques (donnees fictives)
// ----------------------------
// Chaque composant de components/charts/, avec l'ecran du dashboard Spring 2026
// qu'il reproduit. Sert a la revue visuelle ; aucune donnee de la base.

const week = (n: number) => `Week ${n}`;

export default function ChartsGalleryPage() {
  return (
    <Stack gap="lg" pb="xl">
      <PageHeader title="Charts" subtitle="Components reproducing the Spring 2026 dashboard, with sample data." />

      <Text className="label">Dashboard</Text>
      <ChartCard title="Profile distribution · ProfileDonut + RankedBars">
        <ProfileDonut
          slices={[
            { key: "technical", label: "Tech", value: 17 },
            { key: "business", label: "Business", value: 10 },
            { key: "hybrid", label: "Hybrid", value: 7 },
          ]}
        />
        <Divider color="dark.4" />
        <RankedBars
          bars={[
            { key: "a", label: "Operations & People", value: 28 },
            { key: "b", label: "Machine Learning", value: 24 },
            { key: "c", label: "Sales & GTM", value: 22 },
            { key: "d", label: "Product Design", value: 21 },
            { key: "e", label: "Software Engineering", value: 13 },
            { key: "f", label: "Finance & Fundraising", value: 8 },
          ]}
        />
      </ChartCard>
      <ChartCard title="Nationalities · NationalityMap">
        <NationalityMap counts={{ France: 30, "United States": 4, Ukraine: 3, Canada: 1, China: 1, Algeria: 1, "New Zealand": 1, Russia: 1 }} />
      </ChartCard>

      <Text className="label">Founder</Text>
      <ChartCard title="Score breakdown · ScoreRadar + ScoreBreakdown">
        <ScoreRadar
          axes={[
            { label: "E", value: 6 },
            { label: "Ex", value: 10 },
            { label: "L", value: 5.6 },
            { label: "C", value: 10 },
            { label: "A", value: 8.4 },
          ]}
        />
        <ScoreBreakdown
          rows={[
            { key: "e", short: "E", label: "Engagement", weight: 0.2, value: 6, details: <Text size="xs" c="dimmed">Attendance rate: 69%</Text> },
            { key: "x", short: "Ex", label: "Execution", weight: 0.2, value: 10 },
            { key: "l", short: "L", label: "Likability", weight: 0.2, value: 5.6 },
            { key: "c", short: "C", label: "Commitment", weight: 0.2, value: 10 },
            { key: "a", short: "A", label: "Achievements", weight: 0.2, value: 8.4 },
          ]}
        />
      </ChartCard>

      <Text className="label">Startup</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <ChartCard>
          <MetricAreaChart
            title="Total users"
            points={[
              { label: week(4), value: 8 },
              { label: week(5), value: 10 },
            ]}
            format={integer}
          />
        </ChartCard>
        <ChartCard>
          <MetricAreaChart
            title="Total amount paid (€)"
            points={[
              { label: week(4), value: 42000 },
              { label: week(5), value: 100000 },
            ]}
            format={(v) => `€${integer(v)}`}
            unitPrefix="€"
          />
        </ChartCard>
      </SimpleGrid>
      <ChartCard title="Market · MarketBubbles">
        <MarketBubbles
          cagr={0.15}
          sizes={[
            { key: "tam", low: 5.3e9, mid: 6.9e9, high: 9.5e9, reasoning: "Sample reasoning for the total addressable market." },
            { key: "sam", low: 0.5e9, mid: 1.1e9, high: 2e9, reasoning: "Sample reasoning for the serviceable market." },
            { key: "som", low: 50e6, mid: 150e6, high: 350e6, reasoning: "Sample reasoning for the 3-5 year capture." },
          ]}
        />
      </ChartCard>

      <Text className="label">Startups overview (mock page of the dashboard)</Text>
      <ChartCard title="Traction · TrendLine">
        <TrendLine label="Conversations" points={[{ label: "W1", value: 6 }, { label: "W2", value: 14 }, { label: "W3", value: 22 }]} />
        <TrendLine label="Active users" points={[{ label: "W1", value: 40 }, { label: "W2", value: 90 }, { label: "W3", value: 143 }]} />
        <TrendLine label="MRR (€)" points={[{ label: "W1", value: 0 }, { label: "W2", value: 200 }, { label: "W3", value: 750 }]} format={(v) => `€${v}`} color={CHART_COLORS.green} />
      </ChartCard>
      <ChartCard title="Pitch quality · RatingDots + ScoreRadar">
        {[
          ["Pain clarity", 3, 4, 5],
          ["Solution clarity", 2, 3, 4],
          ["Wedge clarity", 2, 3, 3],
          ["Moat clarity", 1, 2, 3],
        ].map(([label, ...weeks]) => (
          <SimpleGrid key={label as string} cols={4} spacing="xs">
            <Text size="sm" c="dimmed" truncate>
              {label}
            </Text>
            {(weeks as number[]).map((v, i) => (
              <RatingDots key={i} value={v} color="orange.5" />
            ))}
          </SimpleGrid>
        ))}
        <ScoreRadar
          axes={[
            { label: "Pain", value: 5 },
            { label: "Solution", value: 4 },
            { label: "Wedge", value: 3 },
            { label: "Moat", value: 3 },
          ]}
          max={5}
          color="orange.5"
          h={180}
        />
      </ChartCard>
      <ChartCard title="Market · RangeBar + RankedBars">
        <RangeBar range={{ label: "TAM", low: 200e9, mid: 350e9, high: 500e9 }} scaleMax={500e9} format={money} />
        <RangeBar range={{ label: "SAM", low: 12e9, mid: 20e9, high: 35e9 }} scaleMax={500e9} format={money} />
        <RangeBar range={{ label: "SOM", low: 0.5e9, mid: 1.2e9, high: 2.5e9 }} scaleMax={500e9} format={money} />
        <Divider color="dark.4" />
        <RankedBars
          max={12}
          sorted={false}
          bars={[
            { key: "l", label: "Large (>$1B)", value: 2, color: CHART_COLORS.red },
            { key: "m", label: "Mid ($10M-$1B)", value: 5, color: CHART_COLORS.orange },
            { key: "s", label: "Small (<$10M)", value: 5, color: CHART_COLORS.green },
          ]}
        />
      </ChartCard>
    </Stack>
  );
}
