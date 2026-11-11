import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, Box, Text } from "@mantine/core";

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
};

function RowBody({ title, subtitle, meta, avatar }: RowProps) {
  return (
    <>
      {avatar && <Avatar src={avatar.photoUrl ?? null} name={avatar.name} color="initials" size={40} radius="xl" />}
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text fw={500} truncate>
          {title}
        </Text>
        {subtitle && (
          <Text size="sm" c="dimmed" truncate>
            {subtitle}
          </Text>
        )}
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

/** Ligne qui declenche une action. */
export function ButtonRow({ onClick, disabled, ...props }: RowProps & { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="row" onClick={onClick} disabled={disabled}>
      <RowBody {...props} />
    </button>
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
