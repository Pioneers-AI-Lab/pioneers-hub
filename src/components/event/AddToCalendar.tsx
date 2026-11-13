"use client";

import { useState } from "react";
import { Button, CopyButton, Stack, Text } from "@mantine/core";
import { API_PUBLIC_URL } from "@shared/api";
import { calendarName, calendarPath } from "@shared/calendar";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";

// ----------------------------
// S'abonner au calendrier du batch (GET /calendar/{batchId}.ics, API publique)
// ----------------------------
// Un abonnement, pas un fichier : un nouvel evenement ou une heure corrigee
// par le staff arrive tout seul dans le calendrier du fondateur. Toujours
// l'adresse de production : un calendrier n'atteint pas un emulateur local.

export function AddToCalendarButton({ batchId, batchName }: { batchId: string; batchName: string }) {
  const [opened, setOpened] = useState(false);
  const https = `${API_PUBLIC_URL}${calendarPath(batchId)}`;
  const webcal = https.replace(/^https:/, "webcal:");
  const options = [
    { label: "Apple Calendar", href: webcal },
    { label: "Google Calendar", href: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` },
    {
      label: "Outlook",
      href: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(calendarName(batchName))}`,
    },
  ];

  return (
    <>
      {/* En tete de section : petit, mais une cible tactile de 40 px. */}
      <Button variant="subtle" size="compact-sm" h={40} px="xs" onClick={() => setOpened(true)}>
        Add to calendar
      </Button>
      <ResponsiveDialog opened={opened} onClose={() => setOpened(false)} title="Add to calendar">
        <Stack>
          <Text size="sm" c="dimmed">
            The whole batch calendar, in one subscription: new sessions and time changes show up on their own. Private meetings
            (office hours, mentor calls) are not in it. Google can take a few hours to refresh.
          </Text>
          {options.map((o) => (
            <Button key={o.label} component="a" href={o.href} target="_blank" rel="noreferrer" variant="default" size="md" fullWidth>
              {o.label}
            </Button>
          ))}
          <CopyButton value={https}>
            {({ copied, copy }) => (
              <Button variant="subtle" size="md" fullWidth onClick={copy}>
                {copied ? "Link copied" : "Copy the link"}
              </Button>
            )}
          </CopyButton>
        </Stack>
      </ResponsiveDialog>
    </>
  );
}
