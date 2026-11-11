import { createTheme, type MantineColorsTuple } from "@mantine/core";

// ----------------------------
// Theme Pioneers (sombre, mobile d'abord)
// ----------------------------
// Charte : bleu `#0DB0F5` sur fond noir, reserve a l'action principale et a
// l'element actif. Polices Mantine par defaut (decision du 11/11) ; les
// chiffres en colonnes s'alignent avec `className="num"` (chiffres tabulaires).
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
    // 42 px : une cible tactile confortable (44 px recommandes, 40 au minimum).
    Button: { defaultProps: { size: "md", radius: "md" } },
    TextInput: inputDefaults,
    Textarea: inputDefaults,
    NumberInput: inputDefaults,
    Select: inputDefaults,
    MultiSelect: inputDefaults,
    TagsInput: inputDefaults,
    // Place pour l'oeil du mot de passe (40 px : `--psi-button-size-md`, globals.css).
    PasswordInput: { defaultProps: { size: "md", rightSectionWidth: 44 } },
    SegmentedControl: { defaultProps: { radius: "md" } },
    Modal: { defaultProps: { centered: true, radius: "md", closeButtonProps: { size: "xl" } } },
    Drawer: { defaultProps: { closeButtonProps: { size: "xl" } } },
  },
});
