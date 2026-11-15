"use client";

import { Button, type ButtonProps } from "@mantine/core";
import { notifyError } from "@/lib/errors";

/**
 * Bouton bascule (Shortlist / Met, Mark done / Done) : allume en variante `light`,
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
