import Link from "next/link";
import type { ReactNode } from "react";
import { Box, Group, Text } from "@mantine/core";
import type { Founder, FounderDirectory, WithId } from "@shared/types";
import { PROFILE_CATEGORY_LABEL } from "@/lib/format";
import { Field } from "@/components/ui/Field";
import { tagsOrNull as tags } from "@/components/ui/Tags";
import { FounderCover } from "./FounderCover";

// ----------------------------
// Carte d'un fondateur dans la grille de l'annuaire
// ----------------------------
// Reprend la galerie du Profile Book FA26 (Airtable) : la photo en couverture,
// puis nom, type de profil, nationalite, le one-liner (`trackRecordOneLiner`,
// une phrase ecrite par le staff, a la place du track record et de « Interested
// in » depuis le 16/11 : ils restent sur la fiche), hard skills, industries,
// formation, entreprises (ces quatre en etiquettes). Un champ vide est masque.
// Sans `directory` (visiteur public), la carte se contente du document racine.

export function FounderGridCard({
  href,
  founder,
  directory,
  startupName,
  meta,
  overlay,
}: {
  href: string;
  founder: WithId<Founder>;
  directory: FounderDirectory | undefined;
  startupName: string | null;
  /** A droite du nom : score (staff, investors) ou « Not linked ». */
  meta?: ReactNode;
  /** Sur la photo, en haut a droite, HORS du lien (un bouton dans un lien n'est pas valide) : Shortlist / Met. */
  overlay?: ReactNode;
}) {
  const category = founder.profileCategory ? PROFILE_CATEGORY_LABEL[founder.profileCategory] : null;
  const context = [category, directory?.nationality, startupName].filter(Boolean).join(" · ");

  return (
    <div className="card-wrap">
      <Link href={href} className="card card-link state-layer">
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

          {founder.trackRecordOneLiner && <Text size="sm">{founder.trackRecordOneLiner}</Text>}
          {/* Grille etroite (2 colonnes sur mobile) : la photo, le nom et la phrase suffisent a
              parcourir le batch ; les etiquettes restent sur la fiche (`.card-details`, globals.css). */}
          <div className="card-details">
            <Field label="Hard skills">{tags(founder.hardSkills, "skill")}</Field>
            <Field label="Industries">{tags(founder.industries, "industry")}</Field>
            <Field label="Education">{tags(directory?.education, "school")}</Field>
            <Field label="Notable companies">{tags(directory?.notableCompanies, "company")}</Field>
          </div>
        </div>
      </Link>
      {overlay && <div className="card-overlay">{overlay}</div>}
    </div>
  );
}
