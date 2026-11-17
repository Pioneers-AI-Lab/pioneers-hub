import { Badge, Group, Text } from "@mantine/core";

// ----------------------------
// Etiquettes (competences, secteurs, roles, ecoles, entreprises)
// ----------------------------
// UNE COULEUR PAR CHAMP, jamais par valeur (docs/UI-RULES.md, 17/11) : la couleur dit
// a quel champ appartient l'etiquette (toutes les competences en indigo, partout), et
// chaque etiquette en a une. Avant : la couleur Airtable de chaque valeur, grise hors
// liste ; une meme teinte pour des sens differents, et du rouge lu comme une alerte.
// Ni le bleu de la marque (action), ni le rouge (erreur), ni l'orange (alerte).
// Une valeur longue (une ecole et son diplome) passe a la ligne, jamais tronquee.

const TAG_KIND_COLOR = {
  skill: "indigo",
  industry: "teal",
  role: "grape",
  school: "yellow",
  company: "pink",
} as const;
export type TagKind = keyof typeof TAG_KIND_COLOR;

/** Le badge Mantine est d'une hauteur fixe et coupe son texte : ici il s'etend sur plusieurs lignes. */
const WRAP_STYLES = {
  root: { height: "auto", minHeight: "var(--badge-height)", maxWidth: "100%", paddingBlock: 2 },
  label: { whiteSpace: "normal", overflow: "visible", textOverflow: "clip", overflowWrap: "anywhere", lineHeight: 1.35, textAlign: "left" },
} as const;

export function Tags({ values, kind }: { values: readonly string[] | null | undefined; kind: TagKind }) {
  if (!values || values.length === 0) return <Text size="sm">-</Text>;
  return (
    <Group gap="xs">
      {values.map((v) => (
        <Badge key={v} variant="light" color={TAG_KIND_COLOR[kind]} radius={6} tt="none" fw={600} styles={WRAP_STYLES}>
          {v}
        </Badge>
      ))}
    </Group>
  );
}

/**
 * Pour un `Field` : les etiquettes, ou `null` si la liste est vide (le champ est
 * alors masque ; `Tags` seul afficherait « - »).
 */
export function tagsOrNull(values: readonly string[] | null | undefined, kind: TagKind) {
  return values && values.length > 0 ? <Tags values={values} kind={kind} /> : null;
}
