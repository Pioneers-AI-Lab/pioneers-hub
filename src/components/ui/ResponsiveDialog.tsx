"use client";

import type { ReactNode } from "react";
import { Box, Drawer, Modal, type ModalProps } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

// ----------------------------
// Une fenetre, adaptee a l'ecran
// ----------------------------
// Mobile (< 48em) : une feuille qui monte du bas, a portee de pouce, coins du
// haut arrondis, hauteur selon le contenu (le clavier la remonte). Tablette et
// ordinateur : une fenetre centree. Meme API que `Modal` pour ce qui sert ici.
// `footer` : l'action de la fenetre (« Apply »), collee au bas de la fenetre
// quand le contenu defile : toujours a portee, meme sur une longue feuille.

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
  size,
  footer,
  children,
}: {
  opened: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Largeur de la fenetre centree (ordinateur) ; la feuille du bas prend toute la largeur. */
  size?: ModalProps["size"];
  footer?: ReactNode;
  children: ReactNode;
}) {
  // `false` avant la mesure (rendu serveur) : fenetre centree, puis ajustee.
  const isMobile = useMediaQuery(MOBILE_QUERY) ?? false;
  const content = (
    <>
      {children}
      {footer && (
        <Box
          pos="sticky"
          bottom={0}
          pt="sm"
          mt="md"
          bg="var(--mantine-color-body)"
          // Colle au bord de l'ecran sur mobile : au-dessus de la barre d'accueil.
          style={{ zIndex: 1, paddingBottom: "calc(var(--mantine-spacing-xs) + env(safe-area-inset-bottom))" }}
        >
          {footer}
        </Box>
      )}
    </>
  );

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
        {content}
      </Drawer>
    );
  }
  return (
    <Modal opened={opened} onClose={onClose} title={title} size={size}>
      {content}
    </Modal>
  );
}
