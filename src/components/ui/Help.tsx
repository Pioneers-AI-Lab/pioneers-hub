"use client";

import type { ReactNode } from "react";
import { ActionIcon, Input } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconHelpCircle } from "@tabler/icons-react";
import touch from "./touch.module.css";

// ----------------------------
// Aides repliees (docs/UI-RULES.md §10, 17/11)
// ----------------------------
// Une explication (pourquoi, comment, qui voit quoi) ne s'affiche qu'au (?) a droite de
// son libelle : champ (`WithHelp`), bloc sans champ (`HelpBlock`), titre de section
// (`Section` `help`). Reste visible, hors de ce mecanisme : un etat ou une donnee, la raison
// d'un blocage, un appel a l'action, la consigne d'un formulaire public (FormSheet, TypeForm
// n'en utilisent pas).

/** L'etat d'une aide repliee et son (?), partages par `WithHelp` et `Section`. */
export function useHelpToggle(label: string) {
  const [isOpen, { toggle }] = useDisclosure(false);
  return { isOpen, toggle: <HelpToggle label={label} open={isOpen} onToggle={toggle} /> };
}

/**
 * Le (?) qui deplie une aide. Dans un `<label>`, il ne donne pas le focus au champ
 * (`preventDefault`). Au doigt, 40 x 40 sans grandir la ligne (`touch.helpButton`).
 */
function HelpToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="md"
      ml={4}
      className={touch.helpButton}
      aria-label={`About ${label}`}
      aria-expanded={open}
      onClick={(e) => {
        e.preventDefault();
        onToggle();
      }}
      style={{ verticalAlign: "middle", flexShrink: 0 }}
    >
      <IconHelpCircle size={16} />
    </ActionIcon>
  );
}

/**
 * Un champ Mantine et son aide repliee, sans hook a l'appel (utilisable en boucle ou sous
 * condition) : `<WithHelp label="Status" help="...">{(p) => <Select {...p} />}</WithHelp>`.
 * Le (?) suit le libelle ; l'aide depliee va dans la `description` du champ (reliee au champ
 * pour un lecteur d'ecran), APRES `note`, ce qui reste visible (un etat, la raison d'un blocage).
 */
export function WithHelp({
  label,
  help,
  note,
  children,
}: {
  label: string;
  help: ReactNode;
  note?: ReactNode;
  children: (field: { label: ReactNode; description: ReactNode }) => ReactNode;
}) {
  const { isOpen, toggle } = useHelpToggle(label);
  const shown = isOpen ? help : null;
  return children({
    // Sans aide (`help` vide selon le cas), pas de (?).
    label: help ? (
      <>
        {label}
        {toggle}
      </>
    ) : (
      label
    ),
    description:
      note && shown ? (
        <>
          {note}
          <br />
          {shown}
        </>
      ) : (note ?? shown ?? undefined),
  });
}

/** Un bloc libelle sans champ (des lignes, des boutons), avec son aide repliee. */
export function HelpBlock({ label, help, children }: { label: string; help: ReactNode; children: ReactNode }) {
  return (
    <WithHelp label={label} help={help}>
      {(field) => (
        <Input.Wrapper labelElement="div" {...field}>
          {children}
        </Input.Wrapper>
      )}
    </WithHelp>
  );
}
