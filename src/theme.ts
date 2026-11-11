import { createTheme, type MantineColorsTuple } from "@mantine/core";

// ----------------------------
// Theme Pioneers (sombre, mobile d'abord)
// ----------------------------
// Charte : bleu `#0DB0F5` sur fond noir, reserve a l'action principale et a
// l'element actif. Titres en Eina 04 (police a fournir par Pioneers, repli
// systeme en attendant), TOUS les chiffres en IBM Plex Mono (`className="num"`).
//
// Regles d'interface (decision du 11/11) :
// - minimaliste : du texte, des filets, peu de cadres ; pas d'icone sauf manque
//   de place, jamais d'emoji ;
// - mobile d'abord : champs en 16 px (sinon iOS zoome a la saisie), cibles
//   tactiles de 44 px, aucune table large (des lignes empilees).

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
const dark: MantineColorsTuple = [
  "#D4D5D8",
  "#B4B6BA",
  "#8F9197",
  "#6B6E75",
  "#2A2C31",
  "#1E1F23",
  "#141518",
  "#0A0A0C",
  "#060607",
  "#030304",
];

// Taille 16 px pour tout ce qui se saisit.
const inputDefaults = { defaultProps: { size: "md" } } as const;

export const theme = createTheme({
  primaryColor: "pioneers",
  primaryShade: 6,
  colors: { pioneers, dark },
  black: "#0A0A0C",
  fontFamilyMonospace: "var(--font-plex-mono), ui-monospace, monospace",
  headings: {
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
    Button: { defaultProps: { size: "sm", radius: "md" } },
    TextInput: inputDefaults,
    Textarea: inputDefaults,
    NumberInput: inputDefaults,
    Select: inputDefaults,
    MultiSelect: inputDefaults,
    TagsInput: inputDefaults,
    PasswordInput: inputDefaults,
    SegmentedControl: { defaultProps: { radius: "md" } },
    Modal: { defaultProps: { centered: true, radius: "md" } },
  },
});
