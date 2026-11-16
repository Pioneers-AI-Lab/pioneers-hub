"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Alert, Avatar, Box, Button, Group, Stack, Text, Title } from "@mantine/core";
import { EXISTING_CO_FOUNDERS_LABELS, type FounderStatus } from "@shared/types";
import { useFounder } from "@/context/FounderContext";
import { useLists } from "@/context/ListsContext";
import { useStartups } from "@/context/StartupsContext";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { missingRequiredFields } from "@/lib/completeness";
import { PROFILE_CATEGORY_LABEL, formatDay } from "@/lib/format";
import { paths } from "@/lib/paths";
import { Field, FieldGrid } from "@/components/ui/Field";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { tagsOrNull as tags } from "@/components/ui/Tags";
import { UpcomingEvents } from "@/components/event/UpcomingEvents";
import { ConnectionButtons } from "./ConnectionButtons";
import { FounderConnections } from "./FounderConnections";
import { QuickContacts } from "./QuickContacts";
import { FounderAttendance, FounderNetwork, FounderPerformance, FounderTeams, FounderWeeks } from "./FounderInsights";

const STATUS_LABEL: Record<FounderStatus, string> = {
  enrolled: "Enrolled",
  active: "Active",
  left: "Left the program",
  alumni: "Alumni",
};

const yesNo = (v: boolean | null | undefined) => (v === true ? "Yes" : v === false ? "No" : null);

/**
 * La fiche d'un fondateur, section par section selon ce que le role peut lire
 * (FounderContext n'a ouvert que les documents autorises). Sert a la fiche et
 * a « Me » (sa propre fiche). `selfSections` (To do, Coming up) ne s'affiche que
 * sur SA fiche, sous les Providers qu'il lit (SelfProviders, monte par le layout).
 * Sur la fiche d'un autre, le staff voit ses prochains evenements (prives compris).
 *
 * Ordre (demande du 15/11) : coordonnees et Shortlist / Met en haut de fiche (plus
 * de section « Contact »), puis ce que lit qui cherche un cofondateur, puis le
 * parcours dans le programme.
 */
export function FounderCard({ selfSections }: { selfSections?: ReactNode }) {
  const { program } = useProgram();
  const { batch, role } = useBatch();
  const { founder, directory, profile, internal, canSeeDirectory, isSelf, canEdit, isDetailsLoading } = useFounder();
  // Le fondateur lui-meme ou le staff : bouton d'edition et alerte « profil incomplet ».
  const editHref = paths.founderEdit(program.id, batch.id, founder.id);
  // L'annuaire, une fois lisible et charge (`directory` est nul si le role ne le lit pas).
  const dir = isDetailsLoading ? null : directory;
  const missing = canEdit && dir ? missingRequiredFields(founder, dir, profile) : [];
  const { startupsById } = useStartups();
  const { colorOf } = useLists();
  const startup = founder.startupId ? startupsById.get(founder.startupId) : undefined;
  const category = founder.profileCategory ? PROFILE_CATEGORY_LABEL[founder.profileCategory] : null;
  const basedIn = dir
    ? [dir.country && `Based in ${dir.country}`, dir.nationality && `${dir.nationality} national`].filter(Boolean).join(" · ")
    : "";

  return (
    <Stack gap={0}>
      <Group gap="md" wrap="nowrap" align="center">
        <Avatar src={founder.photoUrl} name={founder.name} color="initials" size={64} radius="xl" />
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Title order={2} style={{ overflowWrap: "anywhere" }}>
            {founder.name}
          </Title>
          <Text size="sm" c="dimmed">
            {[category, STATUS_LABEL[founder.status]].filter(Boolean).join(" · ")}
          </Text>
          {basedIn && (
            <Text size="sm" c="dimmed">
              {basedIn}
            </Text>
          )}
        </Stack>
        {/* Profil incomplet : l'alerte porte le bouton, un seul appel a l'action. */}
        {canEdit && missing.length === 0 && (
          <Button component={Link} href={editHref} variant="default" size="sm" style={{ flexShrink: 0 }}>
            Edit profile
          </Button>
        )}
      </Group>

      {missing.length > 0 && (
        <Alert color="orange" variant="light" mt="md" p="sm">
          <Group gap="sm" wrap="nowrap" justify="space-between">
            <Box style={{ minWidth: 0 }}>
              <Text fw={600} size="sm">
                Profile incomplete
              </Text>
              <Text size="sm" c="dark.1">
                Missing: {missing.map((m) => m.label).join(", ")}
              </Text>
            </Box>
            <Button component={Link} href={editHref} color="orange" size="sm" style={{ flexShrink: 0 }}>
              Complete
            </Button>
          </Group>
        </Alert>
      )}

      {/* Contacts rapides : ce que l'annuaire du batch connait (fondateurs du batch, staff, investors). */}
      {dir && <QuickContacts directory={dir} slackTeamId={batch.settings.slackTeamId ?? null} />}

      {/* Shortlist / Met : un fondateur du batch, sur la fiche d'un autre. */}
      <ConnectionButtons founderId={founder.id} />

      {founder.trackRecordOneLiner && (
        <Text mt="md" c="dark.1">
          {founder.trackRecordOneLiner}
        </Text>
      )}

      {isSelf ? selfSections : role === "staff" && <UpcomingEvents limit={5} founder={founder} />}

      {canSeeDirectory && isDetailsLoading && <PageLoader />}

      {dir && (
        <>
          <Section title="About">
            <Stack gap="md">
              <Field label="Track record">{dir.trackRecord}</Field>
              <Field label="Introduction">{dir.introduceYourself}</Field>
              {(dir.trackRecord3Liners ?? []).length > 0 && (
                <Field label="Highlights">{dir.trackRecord3Liners.join("\n")}</Field>
              )}
              <Field label="Anything else worth mentioning">{dir.anythingElse}</Field>
            </Stack>
          </Section>

          <Section title="Looking for">
            <FieldGrid>
              <Field label="Interested in working on">{dir.interestedInWorkingOn}</Field>
              <Field label="Looking for a co-founder">{yesNo(dir.lookingForCoFounder)}</Field>
              <Field label="Type of co-founder">{dir.coFounderTypeWanted}</Field>
              <Field label="Skills wanted">{tags(dir.coFounderSkillsWanted, (v) => colorOf("hardSkills", v))}</Field>
              <Field label="Industries to explore">{tags(dir.industriesToExplore, (v) => colorOf("industries", v))}</Field>
              <Field label="Open to join another project">{yesNo(dir.openToJoinAnotherProject)}</Field>
              <Field label="Existing project">{dir.hasExistingProject ? dir.projectExplanation ?? "Yes" : yesNo(dir.hasExistingProject)}</Field>
              <Field label="Existing co-founders">
                {dir.hasExistingCoFounders ? EXISTING_CO_FOUNDERS_LABELS[dir.hasExistingCoFounders] : null}
              </Field>
            </FieldGrid>
          </Section>
        </>
      )}

      <FounderConnections />

      {dir && (
        <Section title="Background">
          <FieldGrid>
            <Field label="Education">{tags(dir.education)}</Field>
            <Field label="Degree">{[dir.degree, dir.fieldOfStudy].filter(Boolean).join(", ")}</Field>
            <Field label="Years of experience">
              {dir.yearsOfXP !== null ? <span className="num">{dir.yearsOfXP}</span> : null}
            </Field>
            <Field label="Notable companies">{tags(dir.notableCompanies)}</Field>
            <Field label="Gender">{dir.gender}</Field>
            <Field label="Main startup in 2025">{dir.mainStartup2025}</Field>
          </FieldGrid>
        </Section>
      )}

      {canSeeDirectory && !isDetailsLoading && !dir && (
        <Section title="Profile book">
          <Empty>No onboarding data yet.</Empty>
        </Section>
      )}

      <Section title="Skills">
        <Stack gap="md">
          <Field label="Hard skills">{tags(founder.hardSkills, (v) => colorOf("hardSkills", v))}</Field>
          <Field label="Industries">{tags(founder.industries, (v) => colorOf("industries", v))}</Field>
          <Field label="Roles I could take">{tags(founder.rolesICouldTake)}</Field>
        </Stack>
      </Section>

      {startup && (
        <Section title="Startup">
          <RowList>
            <LinkRow
              href={paths.startup(program.id, batch.id, startup.id)}
              avatar={{ name: startup.name, photoUrl: startup.logoUrl }}
              title={startup.name}
              subtitle={startup.ideaOneLine}
            />
          </RowList>
        </Section>
      )}

      <FounderPerformance />

      <FounderTeams />
      <FounderAttendance />
      <FounderNetwork />
      <FounderWeeks />

      {profile && [profile.age, profile.birthDayString, profile.tShirtSize, profile.housingSupport].some((v) => v !== null && v !== undefined) && (
        <Section title="Private" hint="Visible to you, the Pioneers team and the investment committee.">
          <FieldGrid>
            <Field label="Age">{profile.age !== null ? <span className="num">{profile.age}</span> : null}</Field>
            <Field label="Birth date">{profile.birthDayString ? <span className="num">{formatDay(profile.birthDayString)}</span> : null}</Field>
            <Field label="T-shirt size">{profile.tShirtSize}</Field>
            <Field label="Housing support">{yesNo(profile.housingSupport)}</Field>
          </FieldGrid>
        </Section>
      )}

      {internal && (
        <Section title="Internal" hint="Pioneers team and investment committee only.">
          <FieldGrid>
            <Field label="Elo score">
              {internal.eloScore !== null ? <span className="num">{Math.round(internal.eloScore)}</span> : null}
            </Field>
            <Field label="Account">{founder.uid ? `Linked ${formatDay(founder.claimedDateISOString?.slice(0, 10))}` : "Not linked"}</Field>
          </FieldGrid>
        </Section>
      )}
    </Stack>
  );
}
