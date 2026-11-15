"use client";

import type { ComponentType, MouseEvent } from "react";
import { Anchor, Button, Group } from "@mantine/core";
import { IconBrandLinkedin, IconBrandSlack, IconBrandWhatsapp, IconMail, IconPhone } from "@tabler/icons-react";
import { slackDmUrl, slackDmWebUrl } from "@shared/slackLinks";
import type { FounderDirectory } from "@shared/types";

// ----------------------------
// Contacts rapides du hero d'une fiche fondateur
// ----------------------------
// Tout ce que l'annuaire du batch connait (`private/directory`, copies de
// `people`) : LinkedIn, email, WhatsApp, telephone, Slack. Une pastille par
// moyen renseigne, masquee sinon. Icones : exception assumee a la regle « pas
// d'icone », la rangee doit tenir sur un ecran de telephone. Sous elle, les
// coordonnees lisibles (email, numeros) : la fiche n'a plus de section
// « Contact » (demande du 15/11), rien de ce qu'elle montrait ne se perd.

type Contact = {
  key: string;
  label: string;
  /** Lien du bouton (ouvert tel quel, ou au clic droit / appui long). */
  href: string;
  icon: ComponentType<{ size?: number; stroke?: number }>;
  external: boolean;
  /** Lien d'application essaye d'abord au clic ; `href` sert de repli s'il ne s'ouvre pas. */
  appHref?: string;
  /** La coordonnee lisible (email, numero), recopiable sous les boutons. */
  text?: string;
};

const externalProps = (external: boolean) => (external ? { target: "_blank", rel: "noreferrer" } : {});

/**
 * Essaie d'ouvrir l'application (`slack://`), puis, si la page n'a pas perdu
 * le focus apres un court delai (application absente : rien ne se passe),
 * ouvre le lien web dans l'onglet. Un nouvel onglet serait bloque : il ne
 * viendrait plus d'un clic.
 */
function openAppOrWeb(event: MouseEvent<HTMLAnchorElement>, appHref: string, webHref: string) {
  event.preventDefault();
  let appOpened = false;
  const onLeave = () => {
    appOpened = true;
  };
  window.addEventListener("blur", onLeave, { once: true });
  document.addEventListener("visibilitychange", onLeave, { once: true });
  window.location.href = appHref;
  window.setTimeout(() => {
    window.removeEventListener("blur", onLeave);
    document.removeEventListener("visibilitychange", onLeave);
    if (!appOpened) window.location.href = webHref;
  }, 1500);
}

const digits = (phone: string) => phone.replace(/[^\d+]/g, "");
const withScheme = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);

/**
 * `slackTeamId` : l'espace Slack du batch. Sans lui, pas de bouton Slack : le
 * lien documente vers un message prive exige l'espace ET le membre.
 */
export function contactsOf(directory: Partial<FounderDirectory>, slackTeamId: string | null): Contact[] {
  const out: Contact[] = [];
  if (directory.linkedinUrl)
    out.push({ key: "linkedin", label: "LinkedIn", href: withScheme(directory.linkedinUrl), icon: IconBrandLinkedin, external: true });
  const { email, whatsapp, phone } = directory;
  if (email) out.push({ key: "email", label: "Email", href: `mailto:${email}`, icon: IconMail, external: false, text: email });
  if (whatsapp)
    out.push({
      key: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/${digits(whatsapp).replace("+", "")}`,
      icon: IconBrandWhatsapp,
      external: true,
      // Le numero n'est ecrit qu'une fois s'il est aussi celui du telephone.
      text: phone && digits(phone) === digits(whatsapp) ? undefined : `WhatsApp ${whatsapp}`,
    });
  if (phone) out.push({ key: "phone", label: "Call", href: `tel:${digits(phone)}`, icon: IconPhone, external: false, text: phone });
  // L'application Slack d'abord (lien documente `slack://`), le client web en repli.
  if (directory.slackUserId && slackTeamId)
    out.push({
      key: "slack",
      label: "Slack",
      href: slackDmWebUrl(slackTeamId, directory.slackUserId),
      appHref: slackDmUrl(slackTeamId, directory.slackUserId),
      icon: IconBrandSlack,
      external: true,
    });
  return out;
}

export function QuickContacts({ directory, slackTeamId }: { directory: Partial<FounderDirectory>; slackTeamId: string | null }) {
  const contacts = contactsOf(directory, slackTeamId);
  const details = contacts.filter((c) => c.text);
  if (contacts.length === 0) return null;
  return (
    <>
      <Group gap="xs" mt="md">
        {contacts.map(({ key, label, href, icon: Icon, external, appHref }) => (
          <Button
            key={key}
            component="a"
            href={href}
            onClick={appHref ? (e: MouseEvent<HTMLAnchorElement>) => openAppOrWeb(e, appHref, href) : undefined}
            {...externalProps(external)}
            variant="default"
            size="sm"
            radius="xl"
            leftSection={<Icon size={16} stroke={1.75} />}
          >
            {label}
          </Button>
        ))}
      </Group>
      {details.length > 0 && (
        <Group gap="md" mt="sm">
          {details.map(({ key, text, href, external }) => (
            <Anchor
              key={key}
              href={href}
              {...externalProps(external)}
              size="sm"
              className="tap-link"
              style={{ overflowWrap: "anywhere" }}
            >
              {text}
            </Anchor>
          ))}
        </Group>
      )}
    </>
  );
}
