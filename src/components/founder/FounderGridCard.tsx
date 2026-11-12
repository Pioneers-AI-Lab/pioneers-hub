import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, Box, Group, Text } from "@mantine/core";
import type { Founder, FounderDirectory, WithId } from "@shared/types";
import { PROFILE_CATEGORY_LABEL } from "@/lib/format";
import { Field } from "@/components/ui/Field";
import { Tags } from "@/components/ui/Tags";

// ----------------------------
// Carte d'un fondateur dans la grille de l'annuaire
// ----------------------------
// Reprend la galerie du Profile Book FA26 (Airtable) : la photo en couverture,
// puis nom, type de profil, nationalite, track record, ce qui l'interesse,
// hard skills, industries, formation, entreprises. Tout est montre en entier,
// comme dans le Profile Book ; un champ vide est masque. Sans `directory`
// (visiteur public), la carte se contente du document racine.

export function FounderGridCard({
  href,
  founder,
  directory,
  startupName,
  meta,
}: {
  href: string;
  founder: WithId<Founder>;
  directory: FounderDirectory | undefined;
  startupName: string | null;
  /** A droite du nom : score (staff, investors) ou « Not linked ». */
  meta?: ReactNode;
}) {
  const category = founder.profileCategory ? PROFILE_CATEGORY_LABEL[founder.profileCategory] : null;
  const context = [category, directory?.nationality, startupName].filter(Boolean).join(" · ");

  return (
    <Link href={href} className="card-link">
      <div className="card-cover">
        {founder.photoUrl ? (
          // Vignette en data URL : next/image n'apporte rien ici.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={founder.photoUrl} alt="" />
        ) : (
          <Avatar name={founder.name} color="initials" size={96} radius="xl" />
        )}
      </div>

      <div className="card-body">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text fw={600} size="lg">
              {founder.name}
            </Text>
            {context && (
              <Text size="sm" c="dimmed">
                {context}
              </Text>
            )}
          </Box>
          {meta && <Box style={{ flexShrink: 0 }}>{meta}</Box>}
        </Group>

        <Field label="Track record">{directory?.trackRecord || founder.trackRecordOneLiner}</Field>
        <Field label="Interested in">{directory?.interestedInWorkingOn}</Field>
        <Field label="Hard skills">{founder.hardSkills.length > 0 ? <Tags values={founder.hardSkills} /> : null}</Field>
        <Field label="Industries">{founder.industries.length > 0 ? <Tags values={founder.industries} /> : null}</Field>
        <Field label="Education">{directory?.education}</Field>
        <Field label="Notable companies">{directory?.notableCompanies?.join(", ")}</Field>
      </div>
    </Link>
  );
}
