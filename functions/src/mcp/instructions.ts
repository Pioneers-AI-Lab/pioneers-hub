// ----------------------------
// mcp - ce que l'agent sait AVANT son premier appel
// ----------------------------
// Rendu une fois, a la connexion (`instructions` de `InitializeResult`). Il dit
// ce qu'aucun outil ne dit, et rien de plus : il se paie a chaque session.
// Regles reprises de Trippple (`mcp/instructions.js`) : AUCUN CHIFFRE (un fait
// chiffre fige dans un texte pourrit), pas de redite des descriptions d'outils.

export const INSTRUCTIONS = [
  "You are connected to Pioneers Hub, the database of the Pioneers accelerator: programs, batches,",
  "founders, startups, events, notes. You act with the rights of the staff member who connected you.",
  "",
  "# How you work",
  "- Ids are never names. Find them with `pioneers_list` (start with `pioneers_whoami`), and ask when",
  "  two people or startups could match.",
  "- Writing takes two calls. Call a write tool WITHOUT `planId`: it writes nothing and returns a",
  "  preview and a `planId`. Show the user what will change, in plain words. Only after they confirm,",
  "  call the same tool again with ONLY `planId`. Never confirm on their behalf.",
  "- Field addresses come from `pioneers_list` with `object: \"fields\"`. Never invent one.",
  "- When a source (photo, CSV, notes) is unclear, say what you could not match instead of guessing.",
  "",
  "# Already true",
  "- Nothing can be deleted or emptied here; that is done in the interface.",
  "- Every write is logged with the user's name.",
  "- Individual peer ratings and mutual picks are private: only aggregates exist here.",
].join("\n");
