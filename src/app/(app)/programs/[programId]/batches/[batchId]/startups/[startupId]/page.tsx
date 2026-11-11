"use client";

import Link from "next/link";
import { Anchor, Avatar, Group, Stack, Text, Title } from "@mantine/core";
import type { StartupStatus } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartup } from "@/context/StartupContext";
import { paths } from "@/lib/paths";
import { ExternalLink, Field, FieldGrid } from "@/components/ui/Field";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

const STATUS_LABEL: Record<StartupStatus, string> = { active: "Active", dead: "Stopped", selection_day_no_go: "Selection Day No Go" };
const yesNo = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : null);

export default function StartupPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { startup, isMember, profile, internal, canSeeProfile, isProfileLoading } = useStartup();
  const { foundersById } = useFounders();

  return (
    <Stack gap={0}>
      <Anchor component={Link} href={paths.startups(program.id, batch.id)} size="sm" c="dimmed" mb="md" w="fit-content">
        All startups
      </Anchor>
      <Group gap="md" wrap="nowrap">
        <Avatar src={startup.logoUrl} name={startup.name} color="initials" size={64} radius="md" />
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Title order={2} style={{ overflowWrap: "anywhere" }}>
            {startup.name}
          </Title>
          <Text size="sm" c="dimmed">
            {[startup.vertical, STATUS_LABEL[startup.status], isMember ? "Your startup" : null].filter(Boolean).join(" · ")}
          </Text>
        </Stack>
      </Group>
      {startup.ideaOneLine && (
        <Text mt="md" c="dark.1">
          {startup.ideaOneLine}
        </Text>
      )}
      {startup.websiteUrl && (
        <Text size="sm" mt="xs">
          <ExternalLink href={startup.websiteUrl} />
        </Text>
      )}

      <Section title="Team">
        {startup.members.length === 0 ? (
          <Empty>No member yet.</Empty>
        ) : (
          <RowList>
            {startup.members.map((m) => {
              const founder = foundersById.get(m.founderId);
              return founder ? (
                <LinkRow
                  key={m.founderId}
                  href={paths.founder(program.id, batch.id, m.founderId)}
                  avatar={{ name: founder.name, photoUrl: founder.photoUrl }}
                  title={founder.name}
                  meta={m.title ?? undefined}
                />
              ) : (
                // Fondateur que le visiteur ne peut pas lire (profil non public).
                <Row key={m.founderId} title="Founder" subtitle="Profile not public" meta={m.title ?? undefined} />
              );
            })}
          </RowList>
        )}
      </Section>

      {canSeeProfile && isProfileLoading && <PageLoader />}
      {canSeeProfile && !isProfileLoading && (
        <Section title="Profile" hint={isMember ? "Visible to your team, the Pioneers team and investors." : undefined}>
          {profile ? (
            <Stack gap="md">
              <Field label="ICP">{profile.icp}</Field>
              <Field label="Problem">{profile.problem}</Field>
              <Field label="Solution">{profile.solution}</Field>
              <Field label="Why now">{profile.whyNow}</Field>
              <Field label="Current status">{profile.currentStatus}</Field>
              <FieldGrid>
                <Field label="Pitch deck">{profile.pitchDeckUrl ? <ExternalLink href={profile.pitchDeckUrl}>Open the deck</ExternalLink> : null}</Field>
                <Field label="Drive folder">{profile.driveFolderUrl ? <ExternalLink href={profile.driveFolderUrl}>Open the folder</ExternalLink> : null}</Field>
              </FieldGrid>
            </Stack>
          ) : (
            <Empty>No profile yet.</Empty>
          )}
        </Section>
      )}

      {internal && (
        <Section title="Internal" hint="Pioneers team and investment committee only.">
          <FieldGrid>
            <Field label="Go">{yesNo(internal.go)}</Field>
            <Field label="Clear idea">{yesNo(internal.clearIdea)}</Field>
            <Field label="High potential">{yesNo(internal.highPotential)}</Field>
            <Field label="Slide quality">{internal.slideQuality !== null ? <span className="num">{internal.slideQuality}</span> : null}</Field>
            <Field label="Achievements">{internal.achievements}</Field>
            <Field label="Risks">{internal.risks}</Field>
            <Field label="Traction notes">{internal.tractionNotes}</Field>
            <Field label="Notes">{internal.notes}</Field>
          </FieldGrid>
        </Section>
      )}
    </Stack>
  );
}
