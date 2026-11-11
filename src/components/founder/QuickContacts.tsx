"use client";

import type { ComponentType } from "react";
import { Button, Group } from "@mantine/core";
import { IconBrandLinkedin, IconBrandSlack, IconBrandWhatsapp, IconMail, IconPhone } from "@tabler/icons-react";
import type { FounderDirectory } from "@shared/types";

// ----------------------------
// Contacts rapides du hero d'une fiche fondateur
// ----------------------------
// Tout ce que l'annuaire du batch connait (`private/directory`, copies de
// `people`) : LinkedIn, email, WhatsApp, telephone, Slack. Une pastille par
// moyen renseigne, masquee sinon. Icones : exception assumee a la regle « pas
// d'icone », la rangee doit tenir sur un ecran de telephone.

type Contact = { key: string; label: string; href: string; icon: ComponentType<{ size?: number; stroke?: number }>; external: boolean };

const digits = (phone: string) => phone.replace(/[^\d+]/g, "");
const withScheme = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);

/**
 * Lien Slack vers la conversation avec la personne : `app_redirect` ouvre
 * l'application (ou le navigateur) sur le DM, sans connaitre l'espace de travail.
 */
const slackHref = (userId: string) => `https://slack.com/app_redirect?channel=${encodeURIComponent(userId)}`;

export function contactsOf(directory: Partial<FounderDirectory>): Contact[] {
  const out: Contact[] = [];
  if (directory.linkedinUrl)
    out.push({ key: "linkedin", label: "LinkedIn", href: withScheme(directory.linkedinUrl), icon: IconBrandLinkedin, external: true });
  if (directory.email) out.push({ key: "email", label: "Email", href: `mailto:${directory.email}`, icon: IconMail, external: false });
  if (directory.whatsapp)
    out.push({
      key: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/${directory.whatsapp.replace(/[^\d]/g, "")}`,
      icon: IconBrandWhatsapp,
      external: true,
    });
  if (directory.phone) out.push({ key: "phone", label: "Call", href: `tel:${digits(directory.phone)}`, icon: IconPhone, external: false });
  if (directory.slackUserId)
    out.push({ key: "slack", label: "Slack", href: slackHref(directory.slackUserId), icon: IconBrandSlack, external: true });
  return out;
}

export function QuickContacts({ directory }: { directory: Partial<FounderDirectory> }) {
  const contacts = contactsOf(directory);
  if (contacts.length === 0) return null;
  return (
    <Group gap="xs" mt="md">
      {contacts.map(({ key, label, href, icon: Icon, external }) => (
        <Button
          key={key}
          component="a"
          href={href}
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          variant="default"
          size="sm"
          radius="xl"
          leftSection={<Icon size={16} stroke={1.75} />}
        >
          {label}
        </Button>
      ))}
    </Group>
  );
}
