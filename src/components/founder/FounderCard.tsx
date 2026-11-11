"use client";

import { Avatar, Group, Stack, Text, Title } from "@mantine/core";
import type { FounderStatus } from "@shared/types";
import { useFounder } from "@/context/FounderContext";
import { useStartups } from "@/context/StartupsContext";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { PROFILE_CATEGORY_LABEL, formatDay } from "@/lib/format";
import { paths } from "@/lib/paths";
import { ExternalLink, Field, FieldGrid } from "@/components/ui/Field";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { Tags } from "@/components/ui/Tags";
import { QuickContacts } from "./QuickContacts";
import { SlackMemberIdField } from "./SlackMemberIdField";
import { FounderAttendance, FounderNetwork, FounderPerformance, FounderTeams, FounderWeeks } from "./FounderInsights";

const STATUS_LABEL: Record<FounderStatus, string> = {
  enrolled: "Enrolled",
  active: "Active",
  left: "Left the program",
  alumni: "Alumni",
};

/** Liste lue : `null` si vide, pour que le champ soit masque. */
const list = (values: readonly string[] | null | undefined) => (values && values.length > 0 ? values.join(", ") : null);

const yesNo = (v: boolean | null | undefined) => (v === true ? "Yes" : v === false ? "No" : null);

const CO_FOUNDERS_LABEL = { in_batch: "In the batch", outside_batch: "Outside the batch", none: "None" } as const;

/**
 * La fiche d'un fondateur, section par section selon ce que le role peut lire
 * (FounderContext n'a ouvert que les documents autorises). Sert a la fiche et
 * a « Me ».
 */
export function FounderCard() {
  const { program } = useProgram();
  const { batch, role } = useBatch();
  const { founder, directory, profile, internal, canSeeDirectory, isDetailsLoading } = useFounder();
  const { startupsById } = useStartups();
  const startup = founder.startupId ? startupsById.get(founder.startupId) : undefined;
  const category = founder.profileCategory ? PROFILE_CATEGORY_LABEL[founder.profileCategory] : null;

  return (
    <Stack gap={0}>
      <Group gap="md" wrap="nowrap" align="center">
        <Avatar src={founder.photoUrl} name={founder.name} color="initials" size={64} radius="xl" />
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Title order={2} style={{ overflowWrap: "anywhere" }}>
            {founder.name}
          </Title>
          <Text size="sm" c="dimmed">
            {[category, STATUS_LABEL[founder.status]].filter(Boolean).join(" · ")}
          </Text>
        </Stack>
      </Group>

      {/* Contacts rapides : ce que l'annuaire du batch connait (fondateurs du batch, staff, investors). */}
      {canSeeDirectory && directory && <QuickContacts directory={directory} slackTeamId={batch.settings.slackTeamId ?? null} />}

      {founder.trackRecordOneLiner && (
        <Text mt="md" c="dark.1">
          {founder.trackRecordOneLiner}
        </Text>
      )}

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

      <Section title="Skills">
        <Stack gap="md">
          <Field label="Hard skills">
            {founder.hardSkills.length ? <Tags values={founder.hardSkills} /> : null}
          </Field>
          <Field label="Industries">{founder.industries.length ? <Tags values={founder.industries} /> : null}</Field>
          <Field label="Roles I could take">
            {founder.rolesICouldTake.length ? <Tags values={founder.rolesICouldTake} /> : null}
          </Field>
        </Stack>
      </Section>

      {canSeeDirectory && isDetailsLoading && <PageLoader />}

      {canSeeDirectory && !isDetailsLoading && directory && (
        <>
          <Section title="About">
            <Stack gap="md">
              <Field label="Introduction">{directory.introduceYourself}</Field>
              <Field label="Track record">{directory.trackRecord}</Field>
              {(directory.trackRecord3Liners ?? []).length > 0 && (
                <Field label="Highlights">{directory.trackRecord3Liners.join("\n")}</Field>
              )}
            </Stack>
          </Section>

          <Section title="Contact">
            <FieldGrid>
              <Field label="Email">
                {directory.email ? <a href={`mailto:${directory.email}`} className="tap-link" style={{ color: "var(--mantine-color-pioneers-4)", overflowWrap: "anywhere" }}>{directory.email}</a> : null}
              </Field>
              <Field label="WhatsApp">
                {directory.whatsapp ? <ExternalLink href={`https://wa.me/${directory.whatsapp.replace(/[^\d]/g, "")}`}>{directory.whatsapp}</ExternalLink> : null}
              </Field>
              <Field label="LinkedIn">{directory.linkedinUrl ? <ExternalLink href={directory.linkedinUrl} /> : null}</Field>
              <Field label="Phone">
                {directory.phone ? <a href={`tel:${directory.phone.replace(/[^\d+]/g, "")}`} className="tap-link" style={{ color: "var(--mantine-color-pioneers-4)" }}>{directory.phone}</a> : null}
              </Field>
              <Field label="Based in">{[directory.country, directory.nationality && `${directory.nationality} national`].filter(Boolean).join(" · ")}</Field>
            </FieldGrid>
            {role === "staff" && <SlackMemberIdField key={directory.slackUserId ?? "none"} founder={founder} current={directory.slackUserId ?? null} />}
          </Section>

          <Section title="Background">
            <FieldGrid>
              <Field label="Education">{directory.education}</Field>
              <Field label="Degree">{[directory.degree, directory.fieldOfStudy].filter(Boolean).join(", ")}</Field>
              <Field label="Years of experience">
                {directory.yearsOfXP !== null ? <span className="num">{directory.yearsOfXP}</span> : null}
              </Field>
              <Field label="Notable companies">{list(directory.notableCompanies)}</Field>
              <Field label="Gender">{directory.gender}</Field>
              <Field label="Main startup in 2025">{directory.mainStartup2025}</Field>
            </FieldGrid>
          </Section>

          <Section title="Looking for">
            <FieldGrid>
              <Field label="Interested in working on">{directory.interestedInWorkingOn}</Field>
              <Field label="Looking for a co-founder">{yesNo(directory.lookingForCoFounder)}</Field>
              <Field label="Type of co-founder">{directory.coFounderTypeWanted}</Field>
              <Field label="Skills wanted">{list(directory.coFounderSkillsWanted)}</Field>
              <Field label="Industries to explore">{list(directory.industriesToExplore)}</Field>
              <Field label="Open to join another project">{yesNo(directory.openToJoinAnotherProject)}</Field>
              <Field label="Existing project">{directory.hasExistingProject ? directory.projectExplanation ?? "Yes" : yesNo(directory.hasExistingProject)}</Field>
              <Field label="Existing co-founders">
                {directory.hasExistingCoFounders ? CO_FOUNDERS_LABEL[directory.hasExistingCoFounders] : null}
              </Field>
            </FieldGrid>
          </Section>
        </>
      )}

      {canSeeDirectory && !isDetailsLoading && !directory && (
        <Section title="Profile book">
          <Empty>No onboarding data yet.</Empty>
        </Section>
      )}

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
