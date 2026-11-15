import { Badge, Group, Text } from "@mantine/core";
import type { TagColor } from "@shared/types";

// ----------------------------
// Etiquettes (competences, secteurs) colorees comme dans Airtable
// ----------------------------
// `colorOf` donne la couleur enregistree d'une valeur (liste fermee :
// `useLists().colorOf`) ; a defaut (texte libre : ecoles, entreprises, roles), un
// gris neutre : une teinte tiree au hasard (du rouge, par exemple) se lirait comme
// une alerte (retour du 15/11). Le bleu d'Airtable devient indigo
// (le bleu de la marque est reserve a l'element actif), le violet grape.
// Une valeur longue (une ecole et son diplome) passe a la ligne, jamais tronquee.

const MANTINE_COLOR: Partial<Record<TagColor, string>> = { blue: "indigo", purple: "grape" };

/** Le badge Mantine est d'une hauteur fixe et coupe son texte : ici il s'etend sur plusieurs lignes. */
const WRAP_STYLES = {
  root: { height: "auto", minHeight: "var(--badge-height)", maxWidth: "100%", paddingBlock: 2 },
  label: { whiteSpace: "normal", overflow: "visible", textOverflow: "clip", overflowWrap: "anywhere", lineHeight: 1.35, textAlign: "left" },
} as const;

export function Tags({
  values,
  colorOf,
}: {
  values: readonly string[] | null | undefined;
  colorOf?: (value: string) => TagColor | null;
}) {
  if (!values || values.length === 0) return <Text size="sm">-</Text>;
  return (
    <Group gap={6}>
      {values.map((v) => {
        const tag = colorOf?.(v);
        return (
          <Badge key={v} variant="light" color={tag ? (MANTINE_COLOR[tag] ?? tag) : "gray"} radius={6} tt="none" fw={600} styles={WRAP_STYLES}>
            {v}
          </Badge>
        );
      })}
    </Group>
  );
}

/**
 * Pour un `Field` : les etiquettes, ou `null` si la liste est vide (le champ est
 * alors masque ; `Tags` seul afficherait « - »).
 */
export function tagsOrNull(values: readonly string[] | null | undefined, colorOf?: (value: string) => TagColor | null) {
  return values && values.length > 0 ? <Tags values={values} colorOf={colorOf} /> : null;
}
