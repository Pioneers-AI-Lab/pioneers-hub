"use client";

import { useState, type ReactNode } from "react";
import { ActionIcon, Input } from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";
import touch from "./touch.module.css";

/**
 * Le libelle d'un champ avec son aide repliee : un (?) a droite du libelle
 * affiche ou masque le sous-texte. A etaler sur un champ Mantine ou un
 * `Input.Wrapper` : `<Select {...useHelp("Status", "...")} />`. Un bloc sans
 * champ (des lignes) : `HelpBlock`.
 * Le bouton dans un `<label>` ne donne pas le focus au champ (contenu interactif).
 * Au doigt, il fait 40 x 40 sans grandir la ligne du libelle (`touch.helpButton`).
 */
export function useHelp(label: string, help: ReactNode) {
  const [isOpen, setOpen] = useState(false);
  return {
    label: (
      <>
        {label}
        <ActionIcon
          variant="subtle"
          color="gray"
          size="md"
          ml={4}
          className={touch.helpButton}
          aria-label={`About ${label}`}
          aria-expanded={isOpen}
          onClick={(e) => {
            e.preventDefault();
            setOpen((o) => !o);
          }}
          style={{ verticalAlign: "middle" }}
        >
          <IconHelpCircle size={16} />
        </ActionIcon>
      </>
    ),
    description: isOpen ? help : undefined,
  };
}

/** Un bloc libelle sans champ (des lignes, des boutons), avec son aide repliee. */
export function HelpBlock({ label, help, children }: { label: string; help: ReactNode; children: ReactNode }) {
  return (
    <Input.Wrapper labelElement="div" {...useHelp(label, help)}>
      {children}
    </Input.Wrapper>
  );
}
