import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, Box, Text } from "@mantine/core";
import { IconArrowUpRight, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { isAppPath } from "@shared/text";

// ----------------------------
// Listes empilees (a la place des tables, illisibles sur mobile)
// ----------------------------
// Une ligne = un titre, une ligne de contexte, une valeur a droite. Toute la
// ligne est la cible tactile (60 px de haut au moins, globals.css `.row`).
// Icone de bout de ligne (docs/UI-RULES.md, 17/11) : `>` mene a une page de l'app,
// `↗` ouvre un autre site, `v` deplie (et se retourne une fois ouvert).

export function RowList({ children }: { children: ReactNode }) {
  return <Box>{children}</Box>;
}

type RowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Valeur a droite (compte, statut, date). */
  meta?: ReactNode;
  /** Nom pour l'avatar a initiales ; `photoUrl` s'il y en a une. */
  avatar?: { name: string; photoUrl?: string | null };
  /** Avant l'avatar (rang d'un classement, avatars d'une equipe). */
  leading?: ReactNode;
};

function RowLeading({ avatar, leading }: Pick<RowProps, "avatar" | "leading">) {
  return (
    <>
      {leading}
      {avatar && <Avatar src={avatar.photoUrl ?? null} name={avatar.name} color="initials" size={40} radius="xl" />}
    </>
  );
}

/** Titre et sous-titre d'une ligne : tronques sur une ligne, ou entiers (`wrap`) quand ils sont une consigne a lire. */
function RowText({ title, subtitle, wrap = false }: Pick<RowProps, "title" | "subtitle"> & { wrap?: boolean }) {
  return (
    <>
      <Text fw={500} truncate={!wrap}>
        {title}
      </Text>
      {subtitle && (
        <Text size="sm" c="dimmed" truncate={!wrap}>
          {subtitle}
        </Text>
      )}
    </>
  );
}

/** `trailing` : l'icone de bout de ligne (navigation, depliage), apres la valeur ; `wrap` : texte entier (`RowText`). */
function RowBody({ title, subtitle, meta, avatar, leading, trailing, wrap }: RowProps & { trailing?: ReactNode; wrap?: boolean }) {
  return (
    <>
      <RowLeading avatar={avatar} leading={leading} />
      <Box style={{ flex: 1, minWidth: 0 }}>
        <RowText title={title} subtitle={subtitle} wrap={wrap} />
      </Box>
      {meta !== undefined && meta !== null && (
        <Box style={{ flexShrink: 0, textAlign: "right" }}>
          {typeof meta === "string" || typeof meta === "number" ? (
            <Text size="sm" c="dimmed">
              {meta}
            </Text>
          ) : (
            meta
          )}
        </Box>
      )}
      {trailing}
    </>
  );
}

/** Les icones de bout de ligne (docs/UI-RULES.md §9) : meme taille, meme gris, meme boite. */
const TRAILING_ICON = { size: 16, color: "var(--mantine-color-dimmed)", style: { display: "block", flexShrink: 0 } } as const;

/** `>` : la ligne, la tuile ou la carte mene a une autre page de l'app (ou ouvre une fenetre). */
export function NavChevron() {
  return <IconChevronRight {...TRAILING_ICON} />;
}

/** `↗` : la ligne ouvre un autre site, dans un nouvel onglet. */
function ExternalArrow() {
  return <IconArrowUpRight {...TRAILING_ICON} />;
}

/** Corps d'une ligne a action (`LinkRow`, `ActionRow`) : le lien prend toute la place a gauche du bouton. */
const LINK_ROW_BODY_STYLE = {
  flex: 1,
  minWidth: 0,
  minHeight: 40,
  alignSelf: "stretch",
  display: "flex",
  alignItems: "center",
  gap: 12,
  color: "inherit",
  textDecoration: "none",
} as const;

/**
 * Ligne cliquable vers une page. `action` : un bouton a droite, HORS du lien (un
 * bouton dans un lien n'est pas valide) ; le texte reste tronque, a l'inverse
 * d'`ActionRow` (consigne a lire en entier).
 */
export function LinkRow({ href, action, ...props }: RowProps & { href: string; action?: ReactNode }) {
  if (action === undefined) {
    return (
      <Link href={href} className="row state-layer">
        <RowBody {...props} trailing={<NavChevron />} />
      </Link>
    );
  }
  return (
    <div className="row">
      <Link href={href} className="row-link" style={LINK_ROW_BODY_STYLE}>
        <RowBody {...props} />
      </Link>
      <Box style={{ flexShrink: 0 }}>{action}</Box>
    </div>
  );
}

/** Ligne cliquable vers un site externe (nouvel onglet). */
export function ExternalLinkRow({ href, ...props }: RowProps & { href: string }) {
  const url = /^https?:\/\//.test(href) ? href : `https://${href}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="row state-layer">
      <RowBody {...props} trailing={<ExternalArrow />} />
    </a>
  );
}

/** Chevron de depliage : `v` qui se retourne une fois ouvert ; `hidden` garde sa place (colonnes alignees). */
export function ExpandChevron({ expanded, size = TRAILING_ICON.size, hidden }: { expanded: boolean; size?: number; hidden?: boolean }) {
  return (
    <IconChevronDown
      size={size}
      color={TRAILING_ICON.color}
      style={{
        ...TRAILING_ICON.style,
        visibility: hidden ? "hidden" : undefined,
        transform: expanded ? "rotate(180deg)" : undefined,
        transition: "transform 150ms ease",
      }}
    />
  );
}

/**
 * Ligne qui declenche une action. Son icone de bout de ligne : `v` si elle deplie un contenu
 * (`expanded`), `>` si elle ouvre une fenetre ou une feuille (`opens` : on y entre, comme une
 * page), aucune si elle agit tout de suite (archiver, marquer, choisir).
 */
export function ButtonRow({
  onClick,
  disabled,
  expanded,
  opens = false,
  ...props
}: RowProps & { onClick: () => void; disabled?: boolean } & ({ expanded: boolean; opens?: never } | { expanded?: undefined; opens?: boolean })) {
  const trailing = expanded !== undefined ? <ExpandChevron expanded={expanded} /> : opens ? <NavChevron /> : undefined;
  return (
    <button type="button" className="row state-layer" onClick={onClick} disabled={disabled} aria-expanded={expanded}>
      <RowBody {...props} trailing={trailing} />
    </button>
  );
}

/** Le corps d'une `ActionRow` : toute la hauteur tactile de la ligne (40 px au moins). */
/**
 * Ligne dont le corps ouvre `href` (page de l'app par `Link` avec `>`, autre site dans
 * un nouvel onglet avec `↗` ; `null` : pas de lien) et qui porte une action a droite,
 * HORS du lien (un bouton dans un lien n'est pas valide). L'action reste au bord :
 * les actions de lignes voisines s'alignent, avec ou sans icone de lien.
 */
export function ActionRow({ href, action, ...props }: Omit<RowProps, "meta"> & { href: string | null; action: ReactNode }) {
  // Une ligne d'action (tache a cocher) se lit en entier : l'action a droite ne tronque rien.
  const body = (trailing?: ReactNode) => <RowBody {...props} wrap trailing={trailing} />;
  return (
    <div className="row">
      {href === null ? (
        <Box style={LINK_ROW_BODY_STYLE}>{body()}</Box>
      ) : isAppPath(href) ? (
        <Link href={href} className="row-link" style={LINK_ROW_BODY_STYLE}>
          {body(<NavChevron />)}
        </Link>
      ) : (
        <a href={href} target="_blank" rel="noreferrer" className="row-link" style={LINK_ROW_BODY_STYLE}>
          {body(<ExternalArrow />)}
        </a>
      )}
      <Box style={{ flexShrink: 0 }}>{action}</Box>
    </div>
  );
}

/** Ligne d'information, sans action. */
export function Row(props: RowProps) {
  return (
    <div className="row">
      <RowBody {...props} />
    </div>
  );
}

/** Le rang en tete de ligne (`leading`) : bleu dans le top 3, ou toujours (`highlight`). */
export function RankNumber({ rank, highlight }: { rank: number; highlight?: boolean }) {
  return (
    <Text className="num" fw={600} w={24} c={highlight || rank <= 3 ? "pioneers" : "dimmed"} style={{ flexShrink: 0 }}>
      {rank}
    </Text>
  );
}
