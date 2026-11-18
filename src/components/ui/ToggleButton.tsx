"use client";

import type { ReactNode } from "react";
import { ActionIcon, Button, type ActionIconProps, type ButtonProps } from "@mantine/core";
import { notifyError } from "@/lib/errors";

/**
 * Bouton bascule (Shortlist / Met, reglages du staff) : allume en variante `light`,
 * eteint en `default`, etat lu par `aria-pressed`. `onToggle` ecrit l'etat inverse ;
 * l'ecran suit l'ecriture locale de Firestore, un refus revient en notification.
 * `disabled` : en attente de l'etat (document pas encore lu).
 */
export function ToggleButton({
  on,
  onToggle,
  ...props
}: Omit<ButtonProps, "variant"> & { on: boolean; onToggle: (next: boolean) => Promise<unknown> }) {
  return <Button {...props} variant={on ? "light" : "default"} aria-pressed={on} onClick={() => void onToggle(!on).catch(notifyError)} />;
}

/**
 * Meme bascule en icone ronde de 40 px, quand la place manque (lignes et cartes de
 * l'annuaire) : allumee en `filled` (une icone a moins de surface qu'un bouton
 * texte pour se distinguer), eteinte en `default`. `label` : son nom accessible
 * (pas d'infobulle). Posee sur une photo (`.card-overlay`), eteinte, fond translucide.
 * `bare` : sans fond, l'icone porte seule l'etat (le cercle d'une tache du To do).
 */
export function ToggleIcon({
  on,
  onToggle,
  label,
  bare = false,
  children,
  ...props
}: Omit<ActionIconProps, "variant" | "children"> & {
  on: boolean;
  onToggle: (next: boolean) => Promise<unknown>;
  label: string;
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <ActionIcon
      size={40}
      radius="xl"
      {...props}
      variant={bare ? "subtle" : on ? "filled" : "default"}
      aria-label={label}
      aria-pressed={on}
      onClick={() => void onToggle(!on).catch(notifyError)}
    >
      {children}
    </ActionIcon>
  );
}
