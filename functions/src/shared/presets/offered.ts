import type { FormIdentityCheck, FormKind } from "../types";

// ----------------------------
// Ce qui est encore propose au staff (decision du 17/11, docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §4.6)
// ----------------------------
// Rien n'est efface, on archive : ce qui est retire reste lu par ce qui le porte deja (formulaires,
// reponses, documents), mais ne se cree plus : Admin > Forms > New et l'editeur de formulaire,
// « Add a form » d'un evenement, Admin > Events > New, `create_form` (API, MCP). Module a part :
// formTemplates et eventTemplates s'importent deja l'un l'autre.

/** Un modele retire (formulaire ou evenement : `retired: true`) ne se cree plus. */
export const isOfferedTemplate = (template: { retired?: boolean }): boolean => template.retired !== true;

/** Une valeur retiree ne se propose plus, sauf a qui l'a deja (`current`, la valeur enregistree) : elle reste lue. */
export const isOffered = <T>(retired: ReadonlySet<T>, value: T, current?: T | null): boolean => value === current || !retired.has(value);

/** Le type de formulaire Picks : la Shortlist et Lock my team le remplacent. */
export const RETIRED_FORM_KINDS: ReadonlySet<FormKind> = new Set<FormKind>(["picks"]);

/** Les choix prives d'un evenement (`picks.pickedFounderIds`) : plus aucune nouvelle question ne les ecrit. */
export const RETIRED_DB_FIELDS: ReadonlySet<string> = new Set(["picks.pickedFounderIds"]);

/** `anonymous` : tout formulaire de fondateur se remplit depuis son compte ; `email_code` : ancien nom d'`account`. */
export const RETIRED_IDENTITY_CHECKS: ReadonlySet<FormIdentityCheck> = new Set<FormIdentityCheck>(["anonymous", "email_code"]);
