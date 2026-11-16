import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/charts/styles.css";
import "./globals.css";
import { Providers } from "./providers";
import { APP_NAME } from "@shared/brand";

// Polices de la charte Pioneers (theme.ts les lit par leurs variables CSS).
// Eina 04 n'existe ici qu'en Light et SemiBold (pas de Regular ni de Medium) :
// chaque fichier couvre une plage de graisses, Light jusqu'a 400 (le texte),
// SemiBold a partir de 500 (titres, onglets, boutons, tout ce qui est en gras),
// sans faux gras du navigateur. Plex Mono (Regular seul) couvre toutes les graisses.
const eina = localFont({
  src: [
    { path: "./fonts/Eina04-Light.ttf", weight: "100 400", style: "normal" },
    { path: "./fonts/Eina04-SemiBold.ttf", weight: "500 900", style: "normal" },
  ],
  variable: "--font-eina",
});
const plexMono = localFont({
  src: "./fonts/IBMPlexMono-Regular.ttf",
  weight: "100 900",
  variable: "--font-plex-mono",
  // Petits sur-titres seulement : pas de prechargement (134 Ko), Eina passe d'abord.
  preload: false,
});

// Adresse du site, base des URL absolues des apercus de lien (og:image) :
// `NEXT_PUBLIC_SITE_URL`, sinon `URL` (fournie par Netlify au build), sinon le serveur local.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Founders, startups and events of the Pioneers batches.",
};

// Mobile : le contenu passe sous la barre d'etat et la barre d'onglets tient
// compte de la zone de securite (`env(safe-area-inset-bottom)`, globals.css).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0A0C",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" {...mantineHtmlProps} className={`${eina.variable} ${plexMono.variable}`}>
      <head>
        <ColorSchemeScript forceColorScheme="dark" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
