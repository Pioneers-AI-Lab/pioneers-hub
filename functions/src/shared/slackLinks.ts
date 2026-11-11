// ----------------------------
// Liens Slack (docs.slack.dev, « Deep linking into Slack »)
// ----------------------------
// On stocke des IDS, jamais des URL : le lien se construit a l'affichage.
//   base     l'espace de travail du batch : `Batch.settings.slackTeamId` (T…)
//   suffixe  le membre : `people.slackUserId` (U… ou W…), copie dans
//            `founders/{id}/private/directory`
// Les schemas `slack://` n'acceptent que des ids (ni nom d'utilisateur, ni
// nom de canal, ni sous-domaine) et ouvrent l'application Slack (macOS,
// Windows, iPhone, Android) ; sans application, un navigateur ne fait rien.
// Aucun lien documente n'ouvre un message a plusieurs ni ne pre-remplit un texte.

/** Espace de travail : `T` + majuscules et chiffres. */
export const isSlackTeamId = (value: string) => /^T[A-Z0-9]{6,}$/.test(value);
/** Membre : `U…`, ou `W…` (Enterprise Grid). */
export const isSlackUserId = (value: string) => /^[UW][A-Z0-9]{6,}$/.test(value);
/** Canal public (`C…`) ou prive (`G…`). */
export const isSlackChannelId = (value: string) => /^[CG][A-Z0-9]{6,}$/.test(value);

/**
 * Message prive par le web : `app_redirect` avec l'id du MEMBRE. Slack ne le
 * documente que pour les canaux, mais il ouvre bien la conversation (verifie
 * le 11/11 sur l'espace du batch). Slack affiche sa propre page de passage
 * (« Opening Slack… ») avant la conversation : on ne peut pas la retirer.
 * `app.slack.com/client/<espace>/<membre>` ne marche PAS (il faut l'id de la
 * conversation, `D…`, propre a chaque paire de personnes).
 */
export const slackDmWebUrl = (teamId: string, userId: string) =>
  `https://slack.com/app_redirect?team=${encodeURIComponent(teamId)}&channel=${encodeURIComponent(userId)}`;

/** Message prive avec un membre : `team` et `id` sont tous deux exiges. */
export const slackDmUrl = (teamId: string, userId: string) =>
  `slack://user?team=${encodeURIComponent(teamId)}&id=${encodeURIComponent(userId)}`;

/** Canal : lien https documente (`app_redirect`), qui fonctionne aussi sans l'application. */
export const slackChannelUrl = (teamId: string, channelId: string) =>
  `https://slack.com/app_redirect?channel=${encodeURIComponent(channelId)}&team=${encodeURIComponent(teamId)}`;
