"use client";

import type { ReactNode } from "react";
import { Drawer, Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

// ----------------------------
// Une fenetre, adaptee a l'ecran
// ----------------------------
// Mobile (< 48em) : une feuille qui monte du bas, a portee de pouce, coins du
// haut arrondis, hauteur selon le contenu (le clavier la remonte). Tablette et
// ordinateur : une fenetre centree. Meme API que `Modal` pour ce qui sert ici.

export const MOBILE_QUERY = "(max-width: 47.99em)";

/**
 * Feuille du bas : hauteur selon le contenu (plafonnee a 90 % de l'ecran),
 * coins du haut arrondis, marge de la zone de securite en bas.
 */
export const BOTTOM_SHEET_STYLES = {
  inner: { alignItems: "flex-end" },
  content: {
    height: "auto",
    maxHeight: "90dvh",
    flex: "0 0 100%",
    width: "100%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  body: { paddingBottom: "calc(var(--mantine-spacing-lg) + env(safe-area-inset-bottom))" },
} as const;

export function ResponsiveDialog({
  opened,
  onClose,
  title,
  children,
}: {
  opened: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  // `false` avant la mesure (rendu serveur) : fenetre centree, puis ajustee.
  const isMobile = useMediaQuery(MOBILE_QUERY) ?? false;

  if (isMobile) {
    return (
      <Drawer
        opened={opened}
        onClose={onClose}
        title={title}
        position="bottom"
        size="auto"
        styles={BOTTOM_SHEET_STYLES}
      >
        {children}
      </Drawer>
    );
  }
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      {children}
    </Modal>
  );
}
