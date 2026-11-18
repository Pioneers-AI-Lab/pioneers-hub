import { FORM_IDENTITY_CHECKS, type FormIdentityCheck, type FormKind } from "../types";

// ----------------------------
// Ce qui est encore propose au staff (decision du 17/11, docs/FONCTIONNALITES.md §4.6)
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

/**
 * Tout formulaire de fondateur se remplit depuis son compte (document du 17/11 : `account`) : plus
 * d'`anonymous` ni de `select_name` (nom choisi dans la liste, rien ne le prouve) ; `email_code` :
 * ancien nom d'`account`. Restent `account` et `jury_link` (le jury, sans compte).
 */
export const RETIRED_IDENTITY_CHECKS: ReadonlySet<FormIdentityCheck> = new Set<FormIdentityCheck>(["anonymous", "select_name", "email_code"]);

/** Les identites encore proposees a un nouveau formulaire : `account` et `jury_link` (`create_form`, `update_form`). */
export const OFFERED_IDENTITY_CHECKS = FORM_IDENTITY_CHECKS.filter((c) => isOffered(RETIRED_IDENTITY_CHECKS, c)) as [FormIdentityCheck, ...FormIdentityCheck[]];
