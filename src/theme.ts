import { createTheme, type MantineColorsTuple } from "@mantine/core";
import touch from "@/components/ui/touch.module.css";

// ----------------------------
// Theme Pioneers (sombre, mobile d'abord)
// ----------------------------
// Charte : bleu `#0DB0F5` sur fond noir, reserve a l'action principale et a
// l'element actif ; bleu clair `pioneers.3` pour les titres de section
// (`SectionTitle`). Les chiffres en colonnes s'alignent avec `className="num"`.
//
// Typographie (demandes du 15/11) : Eina 04 Light pour le texte, Eina 04
// SemiBold pour les titres et tout ce qui est en gras, IBM Plex Mono pour les
// sur-titres en capitales (`.label`, globals.css). Fichiers et plages de
// graisses : app/layout.tsx. Pas d'Eina Regular ni Medium : une graisse 400
// s'affiche en Light, 500 et plus en SemiBold.
//
// Regles d'interface (decision du 11/11) :
// - minimaliste : du texte, des filets, peu de cadres ; pas d'icone sauf manque
//   de place, jamais d'emoji ;
// - mobile d'abord : champs en 16 px (sinon iOS zoome a la saisie), cibles
//   tactiles de 44 px, aucune table large (des lignes empilees). Les petites
//   cibles de Mantine (croix d'une valeur, fleches d'un nombre, choix d'un
//   SegmentedControl, interrupteur, case a cocher, bouton compact) passent a 40 px au doigt
//   seulement (`touch.module.css`, `pointer: coarse`) : rien ne change a la souris.

const pioneers: MantineColorsTuple = [
  "#e2f7fe",
  "#c6ecfc",
  "#94dbf9",
  "#5fcaf7",
  "#36bdf6",
  "#1eb5f5",
  "#0db0f5",
  "#009cdb",
  "#008bc5",
  "#0078ad",
];

// Gris neutres tirant vers le noir. Mantine lit : [0-2] texte, [3] texte
// estompe, [4] bordures, [5] survol, [6] fond des champs, [7] fond de page.
// Texte [0-2] un peu plus clair que d'ordinaire : le Light est fin sur fond noir.
const dark: MantineColorsTuple = [
  "#E6E7EA",
  "#C0C2C6",
  "#9A9CA2",
  "#6B6E75",
  "#2A2C31",
  "#1E1F23",
  "#141518",
  "#0A0A0C",
  "#060607",
  "#030304",
];

const eina = "var(--font-eina), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// Taille 16 px pour tout ce qui se saisit.
const inputDefaults = { defaultProps: { size: "md" } } as const;

export const theme = createTheme({
  // Echelle d'espacement unique, multiples de 4 (docs/UI-RULES.md) : xs 8, sm 12,
  // md 16, lg 24, xl 32. Mantine avait xs 10 et lg 20 : hors echelle.
  spacing: { xs: "0.5rem", sm: "0.75rem", md: "1rem", lg: "1.5rem", xl: "2rem" },
  primaryColor: "pioneers",
  primaryShade: 6,
  colors: { pioneers, dark },
  black: "#0A0A0C",
  fontFamily: eina,
  fontFamilyMonospace: "var(--font-plex-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
  // Deux graisses seulement : le texte en Light, le reste en SemiBold.
  fontWeights: { regular: "300", medium: "600", bold: "600" },
  // Eina Light est fin : pas de texte sous 13 px (le `xs` de Mantine fait 12 px).
  fontSizes: { xs: "0.8125rem" },
  headings: {
    fontFamily: eina,
    fontWeight: "600",
    sizes: {
      h1: { fontSize: "1.75rem", lineHeight: "1.2" },
      h2: { fontSize: "1.375rem", lineHeight: "1.25" },
      h3: { fontSize: "1.125rem", lineHeight: "1.3" },
      h4: { fontSize: "1rem", lineHeight: "1.35" },
    },
  },
  cursorType: "pointer",
  defaultRadius: "md",
  components: {
    // 42 px : une cible tactile confortable (44 px recommandes, 40 au minimum).
    Button: { defaultProps: { size: "md", radius: "md" }, classNames: { root: touch.button } },
    TextInput: inputDefaults,
    Textarea: inputDefaults,
    NumberInput: { ...inputDefaults, classNames: { controls: touch.numberControls } },
    Select: inputDefaults,
    MultiSelect: inputDefaults,
    TagsInput: inputDefaults,
    // Un bloc libelle sans champ (Matching, Forms) : meme taille de libelle que les champs.
    InputWrapper: inputDefaults,
    // Place pour l'oeil du mot de passe (40 px : `--psi-button-size-md`, globals.css).
    PasswordInput: { defaultProps: { size: "md", rightSectionWidth: 44 } },
    // Un lien de texte est souligne : le bleu seul ne le distingue pas d'un titre de
    // section (bleu clair) ni d'un mot en accent (WCAG 1.4.1). Le fil d'Ariane, lui,
    // garde `underline="hover"` (convention).
    Anchor: { defaultProps: { underline: "always" }, styles: { root: { textUnderlineOffset: "3px" } } },
    SegmentedControl: { defaultProps: { radius: "md" }, classNames: { label: touch.segmentLabel } },
    Pill: { classNames: { remove: touch.pillRemove } },
    Switch: { classNames: { body: touch.inlineBody } },
    Checkbox: { classNames: { body: touch.inlineBody } },
    Modal: { defaultProps: { centered: true, radius: "md", closeButtonProps: { size: "xl" } } },
    Drawer: { defaultProps: { closeButtonProps: { size: "xl" } } },
  },
});
