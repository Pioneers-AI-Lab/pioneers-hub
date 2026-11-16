import { Text } from "@mantine/core";

/**
 * Le compteur d'une liste, dans son champ de recherche (a droite) : « 42 », ou
 * « 12 / 42 » une fois filtree. A etaler sur le `TextInput` ; la largeur suit
 * le texte pour que la saisie ne passe pas dessous.
 */
export function searchCount(shown: number, total: number) {
  const label = shown === total ? `${total}` : `${shown} / ${total}`;
  return {
    rightSection: (
      <Text size="sm" c="dimmed" className="num">
        {label}
      </Text>
    ),
    rightSectionWidth: label.length * 8 + 24,
    rightSectionPointerEvents: "none" as const,
  };
}
