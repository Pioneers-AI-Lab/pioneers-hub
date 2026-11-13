import { Badge, Group, Text } from "@mantine/core";
import { TAG_COLORS, type TagColor } from "@shared/types";

// ----------------------------
// Etiquettes (competences, secteurs) colorees comme dans Airtable
// ----------------------------
// `colorOf` donne la couleur enregistree d'une valeur (liste fermee :
// `useLists().colorOf`) ; a defaut, une teinte stable tiree de la valeur, pour
// qu'une valeur ait toujours la meme couleur. Le bleu d'Airtable devient indigo
// (le bleu de la marque est reserve a l'element actif), le violet grape.

const MANTINE_COLOR: Partial<Record<TagColor, string>> = { blue: "indigo", purple: "grape" };

/** Teinte stable d'une valeur sans couleur enregistree. */
function hashColor(value: string): TagColor {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
}

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
        const tag = colorOf?.(v) || hashColor(v);
        return (
          <Badge key={v} variant="light" color={MANTINE_COLOR[tag] ?? tag} radius={6} tt="none" fw={500}>
            {v}
          </Badge>
        );
      })}
    </Group>
  );
}
