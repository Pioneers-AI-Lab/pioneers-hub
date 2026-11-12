import type { ReactNode } from "react";
import { SimpleGrid, Stack, Text } from "@mantine/core";

const isEmpty = (v: ReactNode) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Un libelle et sa valeur. Sur une fiche, un champ vide est MASQUE (une colonne
 * de « - » ne dit rien sur mobile) ; `showEmpty` l'affiche avec `-`.
 */
export function Field({ label, children, showEmpty = false }: { label: string; children: ReactNode; showEmpty?: boolean }) {
  if (isEmpty(children) && !showEmpty) return null;
  return (
    <Stack gap={2}>
      <span className="label">{label}</span>
      {/* `div` : la valeur peut etre un bloc (etiquettes, liens). */}
      <Text component="div" size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {isEmpty(children) ? "-" : children}
      </Text>
    </Stack>
  );
}

/** Une colonne sur mobile, deux a partir de la tablette. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="md">
      {children}
    </SimpleGrid>
  );
}

/** Lien externe affiche comme une valeur (LinkedIn, site, deck). */
export function ExternalLink({ href, children }: { href: string | null | undefined; children?: ReactNode }) {
  if (!href) return null;
  const url = /^https?:\/\//.test(href) ? href : `https://${href}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="tap-link" style={{ color: "var(--mantine-color-pioneers-4)", overflowWrap: "anywhere" }}>
      {children ?? href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
    </a>
  );
}
