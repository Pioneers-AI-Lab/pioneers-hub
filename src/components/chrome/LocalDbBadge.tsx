import { Text } from "@mantine/core";

/**
 * « local db » en jaune, en haut a droite du logo, quand l'app tourne sur les
 * emulateurs (`npm run dev:emu`, `NEXT_PUBLIC_USE_EMULATORS=true`) : on ne
 * confond jamais une copie d'essai avec la prod.
 */
export const IS_LOCAL_DB = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

export function LocalDbBadge() {
  if (!IS_LOCAL_DB) return null;
  return (
    <Text component="span" c="yellow" fz={10} fw={700} lh={1} ml={4} mt={6} style={{ alignSelf: "flex-start", whiteSpace: "nowrap" }}>
      local db
    </Text>
  );
}
