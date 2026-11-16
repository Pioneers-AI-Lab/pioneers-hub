import { APP_NAME } from "@shared/brand";

// ----------------------------
// Logo Pioneers Founder Hub : symbole, « pioneers » en blanc, « Founder Hub » en bleu
// ----------------------------
// Le meme partout : en-tete, pages de connexion, formulaires publics. Le SVG
// fourni (canevas 1209 x 212, « Founder Hub » en mono, 16/11) est recadre sur son
// dessin (viewBox 0 17 1106 111), au meme cadrage vertical que le premier logo :
// a hauteur egale, « pioneers » garde sa taille.
const LOGO_SRC = "/logo-pioneers-founder-hub.svg";
const LOGO_RATIO = 1106 / 111;

export function AppLogo({ height }: { height: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG statique, pas d'optimisation utile.
    <img src={LOGO_SRC} alt={APP_NAME} width={Math.round(height * LOGO_RATIO)} height={height} style={{ display: "block" }} />
  );
}
