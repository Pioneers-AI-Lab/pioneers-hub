import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, Box, Group, Text } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { isAppPath } from "@shared/text";

// ----------------------------
// Listes empilees (a la place des tables, illisibles sur mobile)
// ----------------------------
// Une ligne = un titre, une ligne de contexte, une valeur a droite. Toute la
// ligne est la cible tactile (60 px de haut au moins, globals.css `.row`).

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

function RowBody({ title, subtitle, meta, avatar, leading }: RowProps) {
  return (
    <>
      <RowLeading avatar={avatar} leading={leading} />
      <Box style={{ flex: 1, minWidth: 0 }}>
        <RowText title={title} subtitle={subtitle} />
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
    </>
  );
}

/** Ligne cliquable vers une page. */
export function LinkRow({ href, ...props }: RowProps & { href: string }) {
  return (
    <Link href={href} className="row">
      <RowBody {...props} />
    </Link>
  );
}

/** Ligne cliquable vers un site externe (nouvel onglet). */
export function ExternalLinkRow({ href, ...props }: RowProps & { href: string }) {
  const url = /^https?:\/\//.test(href) ? href : `https://${href}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="row">
      <RowBody {...props} />
    </a>
  );
}

/** Chevron de depliage : `>` qui tourne vers le bas une fois ouvert ; `hidden` garde sa place (colonnes alignees). */
export function ExpandChevron({ expanded, size = 16, hidden }: { expanded: boolean; size?: number; hidden?: boolean }) {
  return (
    <IconChevronRight
      size={size}
      color="var(--mantine-color-dimmed)"
      style={{
        display: "block",
        flexShrink: 0,
        visibility: hidden ? "hidden" : undefined,
        transform: expanded ? "rotate(90deg)" : undefined,
        transition: "transform 150ms ease",
      }}
    />
  );
}

/** Ligne qui declenche une action ; `expanded` si elle deplie un contenu (chevron a droite, sauf `meta`). */
export function ButtonRow({
  onClick,
  disabled,
  expanded,
  meta,
  ...props
}: RowProps & { onClick: () => void; disabled?: boolean; expanded?: boolean }) {
  return (
    <button type="button" className="row" onClick={onClick} disabled={disabled} aria-expanded={expanded}>
      {/* Une ligne repliable porte toujours son chevron, a droite de son `meta` s'il y en a un. */}
      <RowBody
        {...props}
        meta={
          expanded === undefined ? meta : (
            <Group gap={8} wrap="nowrap">
              {meta}
              <ExpandChevron expanded={expanded} />
            </Group>
          )
        }
      />
    </button>
  );
}

/** Le corps d'une `ActionRow` : toute la hauteur tactile de la ligne (40 px au moins). */
const ACTION_ROW_BODY_STYLE = {
  flex: 1,
  minWidth: 0,
  minHeight: 40,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  color: "inherit",
  textDecoration: "none",
} as const;

/**
 * Ligne dont le corps ouvre `href` (page de l'app par `Link`, autre site dans un
 * nouvel onglet ; `null` : pas de lien) et qui porte une action a droite, HORS du
 * lien (un bouton dans un lien n'est pas valide).
 */
export function ActionRow({
  href,
  action,
  title,
  subtitle,
  avatar,
  leading,
}: Omit<RowProps, "meta"> & { href: string | null; action: ReactNode }) {
  // Une ligne d'action (tache a cocher) se lit en entier : le bouton a droite ne tronque rien.
  const text = <RowText title={title} subtitle={subtitle} wrap />;
  return (
    <div className="row">
      <RowLeading avatar={avatar} leading={leading} />
      {href === null ? (
        <Box style={ACTION_ROW_BODY_STYLE}>{text}</Box>
      ) : isAppPath(href) ? (
        <Link href={href} style={ACTION_ROW_BODY_STYLE}>
          {text}
        </Link>
      ) : (
        <a href={href} target="_blank" rel="noreferrer" style={ACTION_ROW_BODY_STYLE}>
          {text}
        </a>
      )}
      {action}
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
