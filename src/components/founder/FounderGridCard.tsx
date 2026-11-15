import Link from "next/link";
import type { ReactNode } from "react";
import { Box, Group, Text } from "@mantine/core";
import type { Founder, FounderDirectory, WithId } from "@shared/types";
import { useLists } from "@/context/ListsContext";
import { PROFILE_CATEGORY_LABEL } from "@/lib/format";
import { Field } from "@/components/ui/Field";
import { tagsOrNull as tags } from "@/components/ui/Tags";
import { FounderCover } from "./FounderCover";

// ----------------------------
// Carte d'un fondateur dans la grille de l'annuaire
// ----------------------------
// Reprend la galerie du Profile Book FA26 (Airtable) : la photo en couverture,
// puis nom, type de profil, nationalite, track record, ce qui l'interesse,
// hard skills, industries, formation, entreprises (ces quatre en etiquettes). Tout est montre en entier,
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
  const { colorOf } = useLists();
  const category = founder.profileCategory ? PROFILE_CATEGORY_LABEL[founder.profileCategory] : null;
  const context = [category, directory?.nationality, startupName].filter(Boolean).join(" · ");

  return (
    <Link href={href} className="card-link">
      <FounderCover founder={founder} />

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
        <Field label="Hard skills">{tags(founder.hardSkills, (v) => colorOf("hardSkills", v))}</Field>
        <Field label="Industries">{tags(founder.industries, (v) => colorOf("industries", v))}</Field>
        <Field label="Education">{tags(directory?.education)}</Field>
        <Field label="Notable companies">{tags(directory?.notableCompanies)}</Field>
      </div>
    </Link>
  );
}
