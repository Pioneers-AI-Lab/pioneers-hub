// ----------------------------
// Les modeles encore proposes au staff (decision du 17/11)
// ----------------------------
// Un modele retire (formulaire ou evenement : `retired: true`) reste lu par ce qui le porte deja,
// mais ne se cree plus : Admin > Forms > New, « Add a form » d'un evenement, Admin > Events > New,
// `create_form` (API, MCP). Module a part : formTemplates et eventTemplates s'importent deja l'un l'autre.

export const isOfferedTemplate = (template: { retired?: boolean }): boolean => template.retired !== true;
