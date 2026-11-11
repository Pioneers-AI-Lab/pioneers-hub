import type { Metadata } from "next";
import { PublicRouletteProvider } from "@/context/PublicRouletteContext";

// Apercu du lien partage (Slack, WhatsApp...) : une banniere fixe. Le serveur
// Next ne lit aucune donnee, l'apercu ne porte donc pas le nom de l'evenement.
// L'URL absolue de l'image : `NEXT_PUBLIC_SITE_URL`, sinon `URL` (fournie par
// Netlify au build), sinon le serveur local.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Lunch roulette · Pioneers Hub",
  description: "Find your lunch table.",
  openGraph: {
    title: "Lunch roulette",
    description: "Find your lunch table.",
    siteName: "Pioneers Hub",
    type: "website",
    images: [{ url: "/lunch-roulette-banner.png", width: 2014, height: 781, alt: "Pioneers lunch roulette" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lunch roulette",
    description: "Find your lunch table.",
    images: ["/lunch-roulette-banner.png"],
  },
};

export default function PublicLunchRouletteLayout({ children }: LayoutProps<"/lunch-roulette/[eventId]">) {
  return <PublicRouletteProvider>{children}</PublicRouletteProvider>;
}
