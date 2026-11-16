"use client";

import { useRef, useState, type ComponentType, type MouseEvent } from "react";
import { Button, Group } from "@mantine/core";
import { useLongPress } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconBrandLinkedin, IconBrandSlack, IconBrandWhatsapp, IconCopy, IconMail, IconPhone } from "@tabler/icons-react";
import { slackDmUrl, slackDmWebUrl } from "@shared/slackLinks";
import type { FounderDirectory } from "@shared/types";

// ----------------------------
// Contacts rapides du hero d'une fiche fondateur
// ----------------------------
// Tout ce que l'annuaire du batch connait (`private/directory`, copies de
// `people`) : LinkedIn, email, WhatsApp, telephone, Slack. Une pastille par
// moyen renseigne, masquee sinon. Icones : exception assumee a la regle « pas
// d'icone », la rangee doit tenir sur un ecran de telephone. Comme Contacts
// iOS (demande du 16/11) : un tap ouvre, un appui long copie (ContactButton).

type Contact = {
  key: string;
  label: string;
  /** Lien du bouton, ouvert au clic. */
  href: string;
  icon: ComponentType<{ size?: number; stroke?: number }>;
  external: boolean;
  /** Lien d'application essaye d'abord au clic ; `href` sert de repli s'il ne s'ouvre pas. */
  appHref?: string;
  /** Ce que copie l'appui long (ou le clic droit), et son nom dans la confirmation. */
  copy?: { value: string; label: string };
};

/** Duree d'appui a partir de laquelle la pastille copie au lieu d'ouvrir. */
const LONG_PRESS_MS = 500;
/** Apres un appui long, le clic qui suit (ou un 2e signal du meme appui) est ignore pendant ce delai. */
const AFTER_LONG_PRESS_MS = 1000;

const isRecent = (time: number) => Date.now() - time < AFTER_LONG_PRESS_MS;

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
  if (directory.linkedinUrl) {
    const url = withScheme(directory.linkedinUrl);
    out.push({
      key: "linkedin",
      label: "LinkedIn",
      href: url,
      icon: IconBrandLinkedin,
      external: true,
      copy: { value: url, label: "LinkedIn link" },
    });
  }
  const { email, whatsapp, phone } = directory;
  if (email)
    out.push({
      key: "email",
      label: "Email",
      href: `mailto:${email}`,
      icon: IconMail,
      external: false,
      copy: { value: email, label: "Email" },
    });
  if (whatsapp)
    out.push({
      key: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/${digits(whatsapp).replace("+", "")}`,
      icon: IconBrandWhatsapp,
      external: true,
      copy: { value: whatsapp, label: "WhatsApp number" },
    });
  if (phone)
    out.push({
      key: "phone",
      label: "Call",
      href: `tel:${digits(phone)}`,
      icon: IconPhone,
      external: false,
      copy: { value: phone, label: "Phone number" },
    });
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

/**
 * Une pastille. Avec `copy`, appui long : AU SEUIL, la pastille passe en bleu,
 * le telephone vibre (Android) et la copie est tentee ; Safari iOS peut la
 * refuser (presse-papiers dans un geste seulement, le minuteur de l'appui n'en
 * est pas forcement un) : elle est alors refaite au RELACHEMENT (`onFinish`),
 * qui en est un. Le clic droit (et l'appui long d'Android, qui le declenche)
 * copie aussi, a la place du menu du navigateur. Le clic qui suit n'ouvre pas
 * le lien : une heure, pas un drapeau remis a zero au debut d'un appui (sur
 * mobile, le navigateur emule un mousedown juste avant ce clic).
 */
function ContactButton({ label, href, icon, external, appHref, copy }: Contact) {
  const [armed, setArmed] = useState(false);
  const Icon = armed ? IconCopy : icon;
  const longPressAt = useRef(0);
  const copiedAt = useRef(0);
  /** Toute tentative vient d'un appui long ou d'un clic droit : elle date aussi l'appui. */
  const tryCopy = (reportFailure: boolean) => {
    longPressAt.current = Date.now();
    if (!copy || isRecent(copiedAt.current)) return;
    navigator.clipboard.writeText(copy.value).then(
      () => {
        if (isRecent(copiedAt.current)) return; // une autre tentative du meme appui a deja reussi
        copiedAt.current = Date.now();
        notifications.show({ message: `${copy.label} copied` });
      },
      () => reportFailure && notifications.show({ color: "red", message: `Could not copy: ${copy.value}` }),
    );
  };
  const longPress = useLongPress(
    () => {
      tryCopy(false);
      setArmed(true);
      navigator.vibrate?.(10);
    },
    {
      threshold: LONG_PRESS_MS,
      cancelOnMove: true,
      onFinish: () => {
        setArmed(false);
        tryCopy(true);
      },
    },
  );
  const copyProps = copy && {
    ...longPress,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      tryCopy(true);
    },
    // Pas d'apercu de lien ni de selection a l'appui long (iOS).
    style: { WebkitTouchCallout: "none", userSelect: "none" } as const,
  };
  return (
    <Button
      component="a"
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (isRecent(longPressAt.current)) e.preventDefault();
        else if (appHref) openAppOrWeb(e, appHref, href);
      }}
      {...externalProps(external)}
      {...copyProps}
      variant={armed ? "filled" : "default"}
      size="sm"
      radius="xl"
      leftSection={<Icon size={16} stroke={1.75} />}
    >
      {label}
    </Button>
  );
}

export function QuickContacts({ directory, slackTeamId }: { directory: Partial<FounderDirectory>; slackTeamId: string | null }) {
  const contacts = contactsOf(directory, slackTeamId);
  if (contacts.length === 0) return null;
  return (
    <Group gap="xs" mt="md">
      {contacts.map((c) => (
        <ContactButton {...c} key={c.key} />
      ))}
    </Group>
  );
}
