// ----------------------------
// Drapeaux d'affichage
// ----------------------------
// Ce qui est masque « pour un retour en arriere facile » : le code reste en
// place, derriere une de ces constantes. Pour le remettre, passer la valeur a
// `true`. Rien d'autre a changer.

/**
 * Onglet « Startups » du batch et tuile « Startups » de l'accueil (demande du
 * client du 15/11) : masques, les startups ne naissent que le 25/11 ; l'onglet
 * « Calendar » a pris sa place. La page /startups reste accessible par URL.
 */
export const SHOW_STARTUPS_TAB = false;

/**
 * Section « Milestones » de l'accueil du batch (Kick-off, Selection Day, Pre-IC,
 * IC, Demo Day) : masquee (demande du client du 15/11), « Next session » et
 * l'onglet « Calendar » disent ce qui arrive.
 */
export const SHOW_MILESTONES = false;
