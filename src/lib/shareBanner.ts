import type { Metadata } from "next";
import { APP_NAME } from "@shared/brand";

// Apercu d'un lien de groupes partage (Slack, WhatsApp...) : une banniere fixe
// (JPEG leger : WhatsApp ignore les images trop lourdes). Le serveur Next ne lit
// aucune donnee, l'apercu ne porte donc pas le nom de l'evenement. URL absolue :
// `metadataBase` du layout racine. X relit les balises og:, d'ou `card` seul.
const BANNER = { url: "/share-banner.jpg", width: 1200, height: 465, alt: "Pioneers lunch roulette" };

export function shareMetadata(title: string, description: string, ogTitle = title): Metadata {
  return {
    title,
    description,
    openGraph: { title: ogTitle, description, siteName: APP_NAME, type: "website", images: [BANNER] },
    twitter: { card: "summary_large_image" },
  };
}
