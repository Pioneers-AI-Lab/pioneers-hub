import type { Metadata } from "next";
import { APP_NAME } from "@shared/brand";

// Apercu d'un lien de groupes partage (Slack, WhatsApp...) : une banniere fixe
// par route (JPEG 1200 px leger : WhatsApp ignore les images trop lourdes). Le
// serveur Next ne lit aucune donnee : la route choisit la banniere (voir
// `paths.groups`). URL absolue : `metadataBase` du layout racine. X relit les
// balises og:, d'ou `card` seul.
const banner = (file: string, alt: string) => ({ url: `/${file}`, width: 1200, height: 465, alt });

const SHARE_BANNERS = {
  groups: banner("share-banner-groups.jpg", "Pioneers Founder Hub groups"),
  lunchRoulette: banner("share-banner-lunch-roulette.jpg", "Pioneers lunch roulette"),
};

export function shareMetadata(banner: keyof typeof SHARE_BANNERS, title: string, description: string, ogTitle = title): Metadata {
  return {
    title,
    description,
    openGraph: { title: ogTitle, description, siteName: APP_NAME, type: "website", images: [SHARE_BANNERS[banner]] },
    twitter: { card: "summary_large_image" },
  };
}
