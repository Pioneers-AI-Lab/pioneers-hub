"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Alert, Avatar, Box, Button, Group, Stack, Text, Title } from "@mantine/core";
import { EDGE_MAX_NOTE } from "@shared/edge";
import { EXISTING_CO_FOUNDERS_LABELS, type FounderStatus } from "@shared/types";
import { useFounder } from "@/context/FounderContext";
import { useStartups } from "@/context/StartupsContext";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { missingRequiredFields } from "@/lib/completeness";
import { PROFILE_CATEGORY_LABEL, formatDay } from "@/lib/format";
import { paths } from "@/lib/paths";
import { Field, FieldGrid } from "@/components/ui/Field";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { SkeletonSections } from "@/components/ui/Skeleton";
import { Empty, Section } from "@/components/ui/Section";
import { tagsOrNull as tags } from "@/components/ui/Tags";
import { EdgeRating } from "@/components/admin/EdgeRating";
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
 * a « Me » (sa propre fiche). `selfSections` (To do) ne s'affiche que sur SA
 * fiche, sous les Providers qu'il lit (SelfProviders, monte par le layout).
 *
 * Ordre (demandes du 15/11, 16/11 et 17/11) : coordonnees et one-liner, filet, boutons
 * Shortlist / Met (plus de section « Contact »), puis ce que lit qui cherche un
 * cofondateur, puis le parcours dans le programme ; les listes Shortlist / Met en bas.
 */
export function FounderCard({ selfSections }: { selfSections?: ReactNode }) {
  const { program } = useProgram();
  const { batch } = useBatch();
  // `dir` : l'annuaire, nul tant qu'il n'est pas lu ou si le role ne le lit pas.
  const { founder, directory: dir, profile, isSelf, canEdit, isDetailsLoading, isDirectoryLoading } = useFounder();
  // Le fondateur lui-meme ou le staff : bouton d'edition et alerte « profil incomplet ».
  const editHref = paths.founderEdit(program.id, batch.id, founder.id);
  // L'alerte et le bouton attendent aussi `profile` : pas de bouton qui devient alerte.
  const canShowEdit = canEdit && !isDetailsLoading;
  const missing = canShowEdit && dir ? missingRequiredFields(founder, dir, profile) : [];
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
        {canShowEdit && missing.length === 0 && (
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

      {founder.trackRecordOneLiner && (
        <Text mt="md" c="dark.1">
          {founder.trackRecordOneLiner}
        </Text>
      )}

      {/* Shortlist / Met sous un filet : un fondateur du batch, sur la fiche d'un autre. */}
      <ConnectionButtons founderId={founder.id} />

      {isSelf && selfSections}

      {/* L'annuaire en route (lien direct, hors de la grille) : des sections fantomes a la place de
          TOUT le bas de la fiche, qui arrive d'un bloc ; rien ne saute au-dessus. */}
      {isDirectoryLoading ? <SkeletonSections count={3} /> : <FounderSections />}
    </Stack>
  );
}

/** Le bas de la fiche, de l'annuaire aux listes Shortlist / Met : affiche une fois l'annuaire lu (ou sans droit de le lire). */
function FounderSections() {
  const { program } = useProgram();
  const { batch, role } = useBatch();
  const { founder, directory: dir, profile, internal, canSeeDirectory, isDetailsLoading } = useFounder();
  const { startupsById } = useStartups();
  const startup = founder.startupId ? startupsById.get(founder.startupId) : undefined;

  return (
    <>
      {dir && (
        <>
          <Section title="About">
            <Stack gap="md">
              <Field label="Track record">{dir.trackRecord}</Field>
              <Field label="Introduction">{dir.introduceYourself}</Field>
              <Field label="Edge">{dir.edge}</Field>
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
              <Field label="Skills wanted">{tags(dir.coFounderSkillsWanted, "skill")}</Field>
              <Field label="Industries to explore">{tags(dir.industriesToExplore, "industry")}</Field>
              <Field label="Open to join another project">{yesNo(dir.openToJoinAnotherProject)}</Field>
              <Field label="Existing project">{dir.hasExistingProject ? dir.projectExplanation ?? "Yes" : yesNo(dir.hasExistingProject)}</Field>
              <Field label="Existing co-founders">
                {dir.hasExistingCoFounders ? EXISTING_CO_FOUNDERS_LABELS[dir.hasExistingCoFounders] : null}
              </Field>
            </FieldGrid>
          </Section>
        </>
      )}

      {dir && (
        <Section title="Background">
          <FieldGrid>
            <Field label="Education">{tags(dir.education, "school")}</Field>
            <Field label="Degree">{[dir.degree, dir.fieldOfStudy].filter(Boolean).join(", ")}</Field>
            <Field label="Years of experience">
              {dir.yearsOfXP !== null ? <span className="num">{dir.yearsOfXP}</span> : null}
            </Field>
            <Field label="Notable companies">{tags(dir.notableCompanies, "company")}</Field>
            <Field label="Gender">{dir.gender}</Field>
            <Field label="Main startup in 2025">{dir.mainStartup2025}</Field>
            <Field label="Repeat founder">{yesNo(dir.repeatFounder)}</Field>
          </FieldGrid>
        </Section>
      )}

      {canSeeDirectory && !dir && (
        <Section title="Profile book">
          <Empty>No onboarding data yet.</Empty>
        </Section>
      )}

      <Section title="Skills">
        <Stack gap="md">
          <Field label="Hard skills">{tags(founder.hardSkills, "skill")}</Field>
          <Field label="Industries">{tags(founder.industries, "industry")}</Field>
          <Field label="Roles I could take">{tags(founder.rolesICouldTake, "role")}</Field>
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

      {/* Private et Internal (profile, internal) arrivent apres l'annuaire : une section fantome
          jusque-la, Shortlist / Met avec elles, pour qu'aucune ne surgisse au-dessus d'une autre. */}
      {isDetailsLoading ? (
        <SkeletonSections count={1} />
      ) : (
        <>
          {profile && [profile.age, profile.birthDayString, profile.tShirtSize, profile.housingSupport].some((v) => v !== null && v !== undefined) && (
            <Section title="Private" help="Visible to you, the Pioneers team and the investment committee.">
              <FieldGrid>
                <Field label="Age">{profile.age !== null ? <span className="num">{profile.age}</span> : null}</Field>
                <Field label="Birth date">{profile.birthDayString ? <span className="num">{formatDay(profile.birthDayString)}</span> : null}</Field>
                <Field label="T-shirt size">{profile.tShirtSize}</Field>
                <Field label="Housing support">{yesNo(profile.housingSupport)}</Field>
              </FieldGrid>
            </Section>
          )}

          {internal && (
            <Section title="Internal" help="Pioneers team and investment committee only.">
              <Stack gap="md">
                <Field label="Account">{founder.uid ? `Linked ${formatDay(founder.claimedDateISOString?.slice(0, 10))}` : "Not linked"}</Field>
                {/* Le staff note l'Edge ici (comme dans Admin > Edge) ; un investor IC lit la note. */}
                <Field label="Edge rating">
                  {role === "staff" ? (
                    <EdgeRating founderId={founder.id} founderName={founder.name} text={dir?.edge ?? null} rating={internal.edge ?? null} />
                  ) : internal.edge ? (
                    `${internal.edge.score}/${EDGE_MAX_NOTE}`
                  ) : null}
                </Field>
              </Stack>
            </Section>
          )}

          {/* Shortlist / Met tout en bas, pour tous ceux qui les lisent (demande du 16/11). */}
          <FounderConnections />
        </>
      )}
    </>
  );
}
