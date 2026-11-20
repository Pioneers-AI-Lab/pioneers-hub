import { Box, Group, Stack } from "@mantine/core";
import styles from "./Skeleton.module.css";

// ----------------------------
// Squelettes de chargement
// ----------------------------
// Pas de copie de chaque ecran : quelques formes qui REPRENNENT les classes des
// vrais elements (`.row`, `.card`, `.card-cover`, `.section`), donc leur
// geometrie, et des lignes de texte dans une boite a la hauteur de la ligne
// reelle. Regle d'usage : un squelette ne remplace que ce qui manque, et
// toujours EN BAS de ce qui est deja affiche ; si la vraie section est plus
// haute ou plus basse, rien ne saute au-dessus. Le reflet et l'apparition
// differee : Skeleton.module.css.

type Size = number | string;

/** Une plaque ; `radius="50%"` : cercle (avatar). */
export function Skeleton({ w = "100%", h, radius, className }: { w?: Size; h: Size; radius?: Size; className?: string }) {
  const classes = className ? `${styles.block} ${className}` : styles.block;
  return <span aria-hidden className={classes} style={{ width: w, height: h, borderRadius: radius }} />;
}

/** Une ligne de texte : la plaque centree dans une boite de la hauteur de la ligne (taille x 1,55). */
function TextLine({ lineHeight, h, w }: { lineHeight: number; h: number; w: Size }) {
  return (
    <Box h={lineHeight} style={{ display: "flex", alignItems: "center" }}>
      <Skeleton h={h} w={w} />
    </Box>
  );
}

/** Lignes fantomes d'une `RowList` : avatar, titre et sous-titre (une ligne de 66 px, comme la vraie). */
export function SkeletonRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={i} className="row" aria-hidden>
      <Skeleton w={40} h={40} radius="50%" />
      <Box style={{ flex: 1, minWidth: 0 }}>
        <TextLine lineHeight={25} h={14} w={`${55 - (i % 3) * 10}%`} />
        <TextLine lineHeight={22} h={11} w={`${80 - (i % 2) * 15}%`} />
      </Box>
    </div>
  ));
}

/** Cartes fantomes d'une grille de cartes (`FounderGridCard`) : couverture 4:3, nom, contexte, phrase. */
export function SkeletonCards({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={i} className="card" aria-hidden>
      <div className="card-cover">
        <Skeleton h="100%" className={styles.fill} />
      </div>
      <div className="card-body">
        <Box>
          <TextLine lineHeight={28} h={16} w={`${65 - (i % 3) * 10}%`} />
          <TextLine lineHeight={22} h={11} w="45%" />
        </Box>
        <Box>
          <TextLine lineHeight={22} h={11} w="100%" />
          <TextLine lineHeight={22} h={11} w="70%" />
        </Box>
      </div>
    </div>
  ));
}

/**
 * Sections fantomes, sans titre (jamais faux) : filet, plaque de titre, trois lignes.
 * Sans conteneur : freres directs des vraies sections, pour leurs marges et filets (`.section:first-child`).
 */
export function SkeletonSections({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => (
    <Stack key={i} gap="xs" className="section" aria-hidden>
      <TextLine lineHeight={21} h={13} w={96 + (i % 2) * 40} />
      <Stack gap={6}>
        <TextLine lineHeight={25} h={12} w="100%" />
        <TextLine lineHeight={25} h={12} w="92%" />
        <TextLine lineHeight={25} h={12} w={`${68 - (i % 3) * 12}%`} />
      </Stack>
    </Stack>
  ));
}

/**
 * Une fiche (fondateur, startup) dont le document n'est pas encore lu : retour,
 * en-tete (avatar 64, nom, ligne de contexte), puis des sections.
 * `avatar` : rond (fondateur) ou carre arrondi (logo de startup).
 */
export function ProfileSkeleton({ avatar = "round" }: { avatar?: "round" | "square" }) {
  return (
    <Stack gap={0}>
      <Box mb="md">
        <Skeleton w={136} h={40} />
      </Box>
      <Group gap="md" wrap="nowrap" align="center">
        <Skeleton w={64} h={64} radius={avatar === "round" ? "50%" : "var(--mantine-radius-md)"} />
        <Box style={{ flex: 1, minWidth: 0 }}>
          <TextLine lineHeight={34} h={22} w="55%" />
          <TextLine lineHeight={22} h={11} w="35%" />
        </Box>
      </Group>
      <SkeletonSections count={3} />
    </Stack>
  );
}
