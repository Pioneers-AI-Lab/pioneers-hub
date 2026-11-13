"use client";

import Link from "next/link";
import { Box, Button, Text } from "@mantine/core";

// ----------------------------
// L'action principale d'une page de l'admin, collee en bas de l'ecran
// ----------------------------
// Sur une liste : « New … », qui ouvre la page (ou la fenetre) d'un nouvel
// element. Sur une page d'edition : creer ou enregistrer, avec le premier
// probleme a corriger au-dessus du bouton.

type ActionBarProps = {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  /** Ce qui empeche l'action, affiche au-dessus du bouton. */
  problem?: string | null;
} & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });

export function ActionBar({ label, loading, disabled, problem, href, onClick }: ActionBarProps) {
  return (
    <Box className="savebar">
      {problem && (
        <Text size="sm" c="red.4" mb={6}>
          {problem}
        </Text>
      )}
      {href ? (
        <Button component={Link} href={href} size="md" fullWidth>
          {label}
        </Button>
      ) : (
        <Button size="md" fullWidth loading={loading} disabled={disabled} onClick={onClick}>
          {label}
        </Button>
      )}
    </Box>
  );
}
