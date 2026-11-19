@AGENTS.md

# Pioneers Founder Hub

Nom affiche : `APP_NAME` (`functions/src/shared/brand.ts`, decision du 15/11), logo `public/logo-pioneers-founder-hub.svg`
(`components/chrome/AppLogo.tsx`). Les identifiants techniques gardent `pioneers-hub`.

Plateforme du batch Pioneers : programmes, batchs, fondateurs, startups, evenements.
Specification : `../SPECS.md`, **seule source de verite** (modele §6.1, qui voit quoi §6.2, scores §5,
dictionnaire des donnees annexe A, champs Airtable SP26 annexe B).

## Stack

- Next.js 16 (App Router, `cacheComponents`), React 19, Mantine 9 en theme sombre force
- Firebase : Auth (Google), Firestore, Cloud Functions TypeScript en `europe-west4`
- Tout est lu cote client (Firestore temps reel) ; le serveur Next ne lit aucune donnee

## Commandes

```bash
npm run dev           # app sur le projet REEL pioneers-3627c (.env.local)
npm run emulators     # Auth 9199, Firestore 8180, Functions 5101, UI 4100 (projet demo-pioneers-hub)
npm run seed          # donnees fictives dans les emulateurs (dans un 2e terminal)
npm run emulators:local   # emulateurs qui gardent leurs donnees (.emulator-data/, ignore par git : donnees personnelles)
npm run pull:prod     # COPIE la prod (lecture seule) dans les emulateurs lances, qu'il vide : memes donnees, memes comptes et uid ; puis dev:emu (« local db » en jaune pres du logo)
npm run dev:emu       # app sur les emulateurs (ignore .env.local)
npm run check:rules   # emulateurs + seed + verification des regles role par role (code de sortie)
npm run check:api     # API /v1 + MCP de bout en bout, emulateurs decales de +200 (tourne a cote de `emulators`)
npm run deploy:rules  # regles + index Firestore sur le projet reel (apres check:rules)
npm run init:prod     # documents de depart du projet reel (rejouable, n'ecrase rien)
npm run grant -- <email> staff|investor ic|investor portfolio|mentor|none   # role d'un compte, reel
node scripts/import-sp26.mjs <bundle.json> --prod   # import du batch Spring 2026 (paquet hors depot, donnees personnelles)
node scripts/import-fa26.mjs <lien-airtable> --prod --overwrite-fa26 [--dry-run]   # batch Fall 2026 depuis la vue partagee du Profile Book (lien hors depot) ; NE JAMAIS LANCER SANS DEMANDER A L'UTILISATEUR : remplace les documents des profils non reclames, donc efface import-fa26-onboarding, anythingElse, repeatFounder, les one-liners et les scores Elo (le script refuse d'ecrire en prod sans --overwrite-fa26)
node scripts/import-fa26-onboarding.mjs <export.csv> --skills <skills.json> [--prod]   # complete FA26 depuis l'export CSV de la vue onboarding (rattachement par nom, remplit le vide, a blanc sans --prod ; fait le 16/11)
node scripts/set-one-liners.mjs <one-liners.json> [--overwrite] [--prod]   # ecrit `founders.trackRecordOneLiner` ({ founderId: texte }), remplit le vide sauf --overwrite, a blanc sans --prod ; textes FA26 rediges en session Claude le 16/11 (fichier hors depot)
node scripts/set-repeat-founders.mjs <repeat-founders.json> [--overwrite] [--prod]   # ecrit `founderDirectory.repeatFounder` ({ founderId: true | false | null }), remplit le vide sauf --overwrite, a blanc sans --prod ; FA26 propose par Claude le 17/11 depuis le track record (fichier hors depot)
node scripts/migrate-drop-public-consent.mjs [--prod]   # retire `founders.publicProfileConsent` de toutes les fiches (cartes publiques pour tous, 17/11), a blanc sans --prod
node scripts/set-photo.mjs <founderId> <image> [--prod]   # photo d'un fondateur deposee par le staff, comme « Mon profil » (photo-*.jpg + vignette), a blanc sans --prod ; Rida Taleb le 16/11
node scripts/import-events.mjs "Week 1" [--prod]   # evenements de data/events.json ET leurs formulaires (a blanc sans --prod, n'ecrase jamais)
node scripts/sync-events.mjs "Week 1" [--prod] [--only cle1,cle2] [--forms jury,debrief]   # MET A JOUR les evenements sur data/events.json (agenda, bareme, matching sans equipes), recree les formulaires sans reponse, archive `archived` ; `--only` : ces evenements seulement (semaine en cours) ; `--forms` : seulement les formulaires de ces modeles (id `<evenement>-<modele>`)
node scripts/audit-fa26.mjs [batchId] [--from YYYY-MM-DD] > inventaire.json   # inventaire en LECTURE SEULE de la prod : evenements a venir, formulaires (questions, identite, dates, reponses), tirages, baremes ; pour comparer a docs/FONCTIONNALITES.md
npm run check:scoring # regles de calcul pures (grille du jury sur 100, Outstanding, tirage par shortlist / met) : chaque suite de scripts/check-scoring/, cas ecrits a la main (harnais scripts/lib/check.mjs)
node scripts/migrate-standard-forms.mjs <batchId> [--prod]   # modele standard : anciens metrics/criteria/picks -> formulaires (a blanc sans --prod)
node scripts/migrate-education-tags.mjs <batchId|--all> [--prod]   # `founderDirectory.education` texte -> liste (separateurs `;` et ` · `, shared/text.ts#splitTextList), a blanc sans --prod
node scripts/migrate-tag-families.mjs [--prod]   # secteurs (64 -> 9 familles, Generative AI retire) et roles (21 -> 12) de tous les batchs, anciennes valeurs archivees dans les listes, puis `batchStats.industriesDistribution` / `rolesDistribution` (card « Profile distribution » : Industries | Skills | Roles) ; a blanc sans --prod, rejouable
node scripts/seed-tasks.mjs <batchId> [--prod]   # taches de depart du To do (Slack, LinkedIn, shortlist), a blanc sans --prod, n'ecrase jamais
node scripts/migrate-metric-keys.mjs <batchId> [--prod]   # cles de metriques standard (SPECS A.5), a blanc sans --prod ; puis backfill-kpis.mjs
node scripts/set-milestone-dates.mjs <batchId> [--prod]   # echeances des milestones du score -> `settings.scoreMilestoneDueDates` (n'ecrit que ce champ ; `weeklyGoalFrom` lu dans les evenements : echeance du DEUXIEME Weekly update, `weeklyGoalFromOf`), a blanc sans --prod, rejouable (relancer si l'agenda deplace un Weekly update)
node scripts/create-batch-form.mjs <batchId> <templateKey> --id <formId> --opens <ISO> --deadline <ISO> [--prod]   # formulaire de batch (sans evenement) depuis un modele, publie, id fixe, n'ecrase jamais ; a blanc sans --prod. Lock my team fa26 cree le 17/11 (fall-2026-lock-my-team, 23/11 16:00 -> 25/11 9:30 Paris)
node scripts/background-draft.mjs <batchId> [--export profils.json | --apply profils.json] [--prod]   # grille Background proposee par Claude (profils anonymes) -> `private/internal.background.proposed` seulement, jamais la note du staff ; a blanc sans --prod. Remplace elo-rank.mjs (supprime au lot 6 : l'Elo est archive, `eloScore` et `eloMatches` gardes mais ni lus, ni affiches, ni rendus par l'API)
node scripts/attach-weekly-forms.mjs <batchId> [--enable] [--prod]   # formulaires hebdomadaires sur les entrees « Weekly Update Form » deja en base : meme plan que la synchro (shared/weeklyForms.ts#weeklyFormsPlan : template `weekly_update`, formulaires manquants), n'ecrase jamais, `--enable` pose `settings.weeklyForms = { enabled: true }` ; a blanc sans --prod, rejouable
node scripts/backfill-shortlist-history.mjs <batchId> [--prod]   # rattrapage `shortlistHistory` depuis les shortlists actuelles (ajout seul, rejouable), a blanc sans --prod
npx firebase deploy --only storage --project prod   # regles Storage (photo-*.jpg du fondateur ou du staff, reste refuse ; lecture par URL a jeton) ; deployees le 16/11, PAS par deploy:rules
npm run typecheck     # route types + front + functions
npm run lint
npm run build
```

Projet reel : `pioneers-3627c` (alias `prod` dans .firebaserc ; `default` reste le projet de demo,
un `firebase deploy` sans `--project prod` ne touche donc rien). Firestore est en `europe-west9`
(Paris), pas en `eur3`. Les scripts admin utilisent les Application Default Credentials.
Cloud Functions : toutes deployees le 14/11 (callables et `api` en europe-west4, declencheurs Firestore en europe-west9,
`nightlyScores` chaque nuit a 2:00 Paris) avec le site Hosting `pioneers-hub-api` :
`npx firebase deploy --only functions,hosting --project prod --force` (`--force` supprime les fonctions retirees du code).
Un tout premier deploiement de declencheurs peut echouer (agent Eventarc pas encore autorise) : relancer quelques minutes apres.
Images de conteneur purgees apres 1 jour (europe-west4 et europe-west9).
Verifications a cote des emulateurs de dev (ports et +200 pris) : `CHECK_PORT_OFFSET=1000 node scripts/emulators-check-config.mjs`
puis `firebase emulators:exec --config .firebase-check.json ...` ; check-rules a alors besoin de `FUNCTIONS_EMULATOR_HOST=127.0.0.1:6101`.
Scores (SPECS §5.5) : `services/scores.ts` (formules pures `shared/scoring.ts`, bareme `shared/scoringRules.ts`) ecrit `scores`,
`scoreSignals`, `founderStats` et `batchStats` (`shared/batchStats.ts`, accueil du batch) ; jamais pour un batch
`settings.scoresSource: "imported"` (spring-2026). Echelle (17/11) : un score du Hub est sur 100 (`scale: 100`,
piliers `FOUNDER_PILLARS`, Outstanding jusqu'a 120) ; un score sans `scale` est sur 10 (Spring 2026) :
TOUJOURS lire `scoreScaleOf` / `scaleRulesOf` (types/score.ts) et afficher par `formatScore` (lib/format.ts).
Evenement : `attendanceOptional` (presence relevee, mais ni elle ni ses formulaires ne comptent dans Engagement ;
Admin > Events > Attendance ou data/events.json) et `hackathonWeight` (poids dans Hackathons d'Execution, absent = 1 ; le H5 = 4).
Poids de la Program Performance (18/11, `FOUNDER_PILLAR_WEIGHTS`, lire `scaleRulesOf(score).pillarWeights`) : Engagement 10,
Execution 50, Likability 30, Edge 10 ; Commitment (projet 50 / cofondateurs 50) et Background a 0 % : calcules, montres au staff
« not counted », jamais comptes (un signal a 0 % de meme : Background du Team d'une startup). Edge : texte du fondateur
`founderDirectory.edge` (obligatoire) note 0-5 par le staff (`private/internal.edge` avec `ratedText` : texte change = « To rate »,
`shared/edge.ts`, Admin > Edge, fiche du fondateur, action `rate_edge`, regle `edgeOk`).
Likability : shortlists recues (`shortlistHistory/{founderId}_{targetId}`, chaque fondateur shortliste AU MOINS UNE FOIS, ajout seul par le
declencheur `onConnectionsWritten`, rattrapage `backfill-shortlist-history.mjs`) rapportees a la moitie du batch (plafond 100) 50 %,
ressenti moyen du peer rating 50 %. Milestones d'Execution : dues seulement
apres leur echeance `batch.settings.scoreMilestoneDueDates` (shortlistDone, met, teamedUp, problemValidated, weeklyGoalFrom ;
`set-milestone-dates.mjs`) ; Weekly goal et Problem validated viennent de `founderReviews`, la Traction de la startup de
`startupReviews`. Formulaires hebdomadaires (decision du 18/11 : le Hub suit l'agenda, shared/weeklyForms.ts) : la synchro de
l'agenda donne a chaque entree « Weekly Update Form » (nom compare par `nameKey`) le template `weekly_update`, dont le pack
cree Weekly update founder et Weekly update startup rattaches a l'entree (`<evenement>-<modele>`), publies, ouverts a son
debut, echeance 24 h, le jour dans le titre ; deplaces ou fermes avec elle. Interrupteur : `settings.weeklyForms.enabled`
(`startDayString` n'est plus lu, plus de fonction programmee). Applicable a la main (Template). Sans presence
(`withoutAttendance`, `attendance.ts#tracksAttendance`) : pour tout le batch, aucun absent, hors presence d'Engagement,
comptes dans Forms on time. `previousGoal` = l'objectif du Weekly update founder PRECEDENT du batch. Callables : `call()` (lib/firebase.ts) retire les cles `undefined`
(le SDK les enverrait en `null`, qu'un schema zod `.optional()` refuse).
Grille Pitch (lot 5, `shared/pitchGrid.ts`) : dix criteres de 0 a 5 (`evaluation.scores.<cle>`, points 20/10/10 | 20/20 | 6/5/4/3/2 ;
famille Team au 18/11 : teamStrength, edgeComplementarity, founderMarketFit = Market edges)
en trois familles Team 40 / Speed of execution 40 / Market 20 (anciennes cles SP26 sur 5 : `legacyPitchScores`), puis
`evaluation.overallScore`, `decision` (etapes), `wouldInvest` et `betLikelihood` (avant l'IC). Les modeles de pitch
(`pitch_day`... `ic`) creent le Pitch deck (`pitch_deck`, startup, 48 h avant -> la veille) et le jury, et posent le bareme
`PITCH_SCORING` (Outstanding du staff a 100 sur la Submission de la startup, comme un hackathon ; pas dans l'Execution).
Score startup : familles des pitchs passes (moyenne des jures par critere, puis des pitchs), publies ou non ; Team = famille Team.
Un pitch venu de l'agenda : Admin > Events > l'evenement, template « Pitch day » (formulaires + bareme) et ses startups (`startupIds` = cibles du jury).
Un seul `next dev` par dossier (Next 16) : arreter `dev:emu` avant `dev`, et inversement. Pour
verifier un build a cote d'un `next dev` : `NEXT_DIST_DIR=.next-emu next build` puis
`NEXT_DIST_DIR=.next-emu next start` (Next ajoute alors `.next-emu` au tsconfig : ne pas le commiter).

Donnees : batch `spring-2026` (termine) importe du dashboard spring2026.thepioneer.vc (ids Airtable,
reimport sans perte des rattachements). Batch `fall-2026` importe le 12/11 de la vue partagee
« Pioneers Profile Book - FA26 » (32 fondateurs, ids Airtable, sans email : rattachement par /claim).
Noms affiches des batchs : `fa26` et `sp26` (comme sur Slack) ; les ids restent `fall-2026` / `spring-2026`.
Evenements de fa26 : batch RELIE le 16/11 (18h) a l'agenda Google « Pioneers Residency FA2026 » (`c_04d9a8cb…@group.calendar.google.com`) : 37 des 38 evenements du Hub relies, 23 crees (semaines 3+, office hours, Weekly Update Form, IC) ; doublon du hackathon 5 (journee entiere dans Google) masque, le H5 du Hub (formulaires, matching) reste NON relie, en 9:30-19:30. Avant : data/events.json aligne a la main sur cet agenda, 38 evenements en base. Semaine 1 synchronisee le 14/11, retouchee le 16/11 avec `--only` (lieux, The Mom Test le 18/11, Benoit Miegeville deplace au 24/11) ; semaine 2 importee le 16/11 (formulaires du hackathon 5 et Picks du hackathon 4 en brouillon). Le 16/11, les 38 sont identiques au calendrier champ par champ (nom exact, description exacte, lieu, debut, fin) ; visio Google Meet dans `videoCallUrl` (champ du fichier ; avant le 16/11 dans `resourceUrl`, deplacee par migrate-video-call-links.mjs) ; seule exception : le hackathon 5, en journee entiere dans le calendrier, va du 25/11 9:30 au 27/11 19:30. NE PAS relancer la semaine 1 en entier : elle recreerait les Submissions H1 et H2 et Founder introductions, retouchees le 15/11 (utiliser `--only`).
Reimport : un profil reclame garde son rattachement, ses valeurs non vides et sa photo (meme retiree) ; l'import ne touche que les photos des profils non reclames.
Photo depuis « Mon profil » (fondateur ou staff) : `founders/{id}/photo-*.jpg` (storage.rules), vignette + `coverPhotoUrl` en un lot, croix pour la retirer.
Photos et logos : vignettes JPEG 128 px en `data:` URL dans `photoUrl` / `logoUrl` (avatars).
Grandes photos dans Storage (bucket `pioneers-3627c.firebasestorage.app`, europe-west9, cree le 12/11) :
`founders/{id}/cover.jpg` (800 px au plus), URL a jeton dans `founders.coverPhotoUrl` (couverture des
cartes de l'annuaire). `storage.rules` refuse tout acces direct ; qui lit le document a l'URL.
SP26 n'a que ses vignettes (originaux non gardes). Emulateur Storage : port 9399.

Les ports des emulateurs sont decales des valeurs par defaut : une autre suite
(Trippple) tourne souvent sur 4000/5001. `firebase-tools` est epingle en local
(14.27) : la 15 exige Java 21, la 14.16 globale ne charge pas firebase-functions v7.

## API et MCP (`functions/src/api`, `mcp`, `services`)

Modeles sur le MCP de Trippple (`trippple/my-mantine-app/functions/mcp`, ses `doc.md` portent les mesures).
Une fonction `api` (Express) servie par le site Hosting **`pioneers-hub-api`** :
`https://pioneers-hub-api.web.app/v1` (REST, scripts) et `/mcp` (Claude). Emulateur Hosting : port 5102.

- **Les services portent la regle metier une fois** (`services/*.ts`, une `Operation` = `plan` qui lit +
  `commit` qui ecrit) ; /v1 et le MCP ne font que les appeler. Audit (`auditLogs`) dans la meme transaction.
- **Appelant** (`api/caller.ts`) : cle `ph_live_` (callables `createApiKey` / `revokeApiKey`, empreinte seule
  stockee), jeton OAuth `pha_` (connecteur Claude, /mcp seulement) ou ID token Firebase. Pas de portees : le role, relu a
  chaque requete, avec les rattachements (`api/viewer.ts#loadAccount`). **Tout compte connecte** (`canUseApi`) ;
  l'Admin SDK ignorant les regles, `services/read.ts` filtre chaque objet et `services/fields.ts` chaque ecriture avec
  `shared/access.ts` (miroir de firestore.rules) : un fondateur ne change que « Mon profil », un investor lit,
  le staff fait tout. Le catalogue MCP suit le role (`visibleTo`). `check:api` verifie chaque role.
- **Confirmation MCP** : un outil d'ecriture sans `planId` stocke un `writePlans` et rend l'apercu ; avec
  `planId` seul, il recalcule, refuse si l'apercu a change (`plan_stale`), ecrit. /v1 : `?dryRun=true` et
  `Idempotency-Key` (verifiee dans la transaction).
- **Ecritures de champs** : `set_fields` lit le registre (`shared/fieldRegistry.ts`) : validation, listes
  fermees (cle ou libelle), `fill_empty` / `overwrite` / `merge_unique`, aucune valeur vide, copies
  `people` -> fondateurs. Les documents de suivi (semaine, update, presence, soumission) se creent a la demande.
  Le plan (`planFieldWrites`) a un mode `partial` (un champ fautif est ecarte, pas l'appel : formulaires)
  et un `hold` (calcule, pas ecrit : validation du staff). /v1 et le MCP restent en « tout ou rien ».
  Une URL sans protocole est completee (`shared/text.ts#normalizeHttpUrl`).
- **Agenda Google = source des evenements** (SPECS §2, 16/11) : un batch avec `settings.googleCalendarId` (Admin >
  Batch settings, « Check » a blanc) recoit les evenements de SA periode, sens unique Google -> Hub (services/calendarSync.ts,
  plan pur shared/calendarSync.ts) : a chaque changement (notification `events.watch` -> fonction `googleCalendarWebhook`,
  un canal par batch dans `calendarSyncs.channel`, secret verifie, pris a la premiere synchro et renouvele 1 jour avant
  ses 7 jours), toutes les 30 min en filet (`syncGoogleCalendars`, qui renouvelle aussi) ou sur « Sync now »
  (`syncBatchCalendar`). Un evenement relie porte `calendarSource` : ses `CALENDAR_FIELDS` (nom, description, dates,
  lieu, visio `videoCallUrl` = Meet ou `conferenceData`) ne s'ecrivent QUE par la synchro (regles, `lib/eventsAdmin.ts#updateEvent` les retire, `sync-events.mjs` les saute) ;
  le reste (invites, template via TemplateField, matching, formulaires) se regle dans le Hub (la synchro ne pose que le template `weekly_update` des entrees « Weekly Update Form » et leurs formulaires). Un batch relie ne cree
  pas d'evenement (regle, `create_event`, `import-events.mjs` refusent). Masquer = archiver, la synchro le laisse masque ;
  supprime ou annule dans Google = archive. Jeton et derniere synchro : `calendarSyncs/{batchId}`. Prod : API Calendar activee
  (16/11), partager l'agenda (« See all event details ») avec `804975656292-compute@developer.gserviceaccount.com`. Visio
  d'avant le 16/11 dans `resourceUrl` : `node scripts/migrate-video-call-links.mjs <batchId> [--prod]` (deplace vers `videoCallUrl`, a blanc sans --prod, APRES le front). Emulateurs : faux agenda
  `calendarFakes/{calendarId}` ({ events }, scripts/check-rules.mjs).
- **Evenement = point d'entree** (SPECS §2, decision du 13/11) : son type (`kind`) n'est qu'une ETIQUETTE ; les
  outils viennent de ce qui est attache : `event.matching` (0 ou 1 : mode `challenge` = equipes, `matching` = tables,
  taille ; groupes dans `teams`) et ses formulaires. Un evenement d'avant sans le champ le deduit de son type et de
  `teamSize` : TOUJOURS lire `matchingOf(event)` (shared/events.ts) ; cible du jury `juryTargetOf` (groupes du
  matching, sinon startups) ; leaderboard des qu'une grille de jury ou une metrique classe. Un modele
  (presets/eventTemplates.ts) est un PACK : evenement (etiquette, duree, heure) + matching + formulaires, crees ensemble
  (`eventFormsPlan` : publies si l'evenement est programme, brouillons sinon) par Admin > Events > New (blank |
  template, reglages facon agenda, « Create » / fleche « Create as draft », `lib/eventsAdmin.ts#createEventPack`),
  `create_event` et l'import. Staff : `/admin/events/{id}` = la page hub (reglages, presence, matching, formulaires,
  classement, resultats, jury, picks archives), `/admin/events/{id}/matching` (TeamGenerator), `/admin/events/{id}/teams/{teamId}`
  (resultats). Un tirage PUBLIE se retouche (echanger, deplacer, leader, retardataire) avec confirmation ; ids d'equipe
  stables, `memberships` suivent, pas de retirage ni de depublication. Deplacer un evenement propose de deplacer ses
  formulaires (`shared/eventForms.ts#planEventMove`, regles de creation) et le Debrief accole ; l'archiver ferme ses
  formulaires ouverts (rouverts a la restauration). `/admin/challenge-teams/**` et `/admin/lunch-roulette/**` redirigent. Tous : `/programs/…/batches/…/events/{id}`
  (`EventPageContext` : infos, mon groupe, formulaires a faire / fait / ferme, leaderboard) ; `EventRow` y mene.
  Page publique des groupes : `paths.groups(id, mode)` donne `/lunch-roulette/{id}` pour des tables, `/groups/{id}` pour des
  equipes (`/challenge-teams/{id}`, ancien lien, idem) : meme page, seule la banniere de l'apercu du lien change
  (`lib/shareBanner.ts`, `public/share-banner-*.jpg` en 1200 px ; `metadataBase` dans le layout racine).
- **Modele standard** (SPECS §2, decision du 12/11) : un evenement = une entree d'agenda + un tirage de groupes
  (`teams`) + des FORMULAIRES. Toute saisie passe par un formulaire rattache a l'evenement : le Debrief d'un
  hackathon (metriques = questions `submission.metrics.<cle>`, avis = `peerRating.*`), le jury
  (`evaluation.scores.<cle>`, poids sur la question). L'evenement ne porte
  ni `metrics` ni `criteria` ni `picks` (seulement `rankingMetricKey`) ; `shared/forms.ts#juryCriteria` /
  `eventMetrics` les relisent dans ses formulaires. Stockage type inchange (submissions, peerRatings,
  evaluations, picks). Formulaires d'un evenement crees par `shared/eventForms.ts` (import, migration) ou depuis
  sa page d'admin (modeles `debrief`, `peer_rating`, `jury`, `week_retro`, `pitch_deck`...).
- **Retire le 17/11, archive** (lot 6, docs/FONCTIONNALITES.md §4.6 ; rien n'est efface) :
  `shared/presets/offered.ts` dit ce qui ne se cree plus et reste lu (`isOffered(retire, valeur, valeur enregistree)`).
  Modeles `retired` (Picks, Founder introductions, Exit form, Thursday update `weekly_update`, inscriptions Selection
  Day / Pre-IC remplacees par le Pitch deck...) ; modeles d'evenement retires (`edge_drill`, `customer_discovery`,
  `vibethon`, `founder_introductions`) : `OFFERED_EVENT_TEMPLATE_KEYS` (Admin > Events, enums de `create_event` et
  `apply_event_template`). Type de formulaire `picks`, identites `anonymous` et `select_name` (defaut `account`)
  et champ `picks.pickedFounderIds` : proposes seulement au formulaire / a la question qui les a deja, LA regle
  `formRules.ts#retiredFormProblems(form, stored)` (editeur, `saveForm`, `create_form` et `duplicatedForm` avec
  `stored = null` ; `create_form` / `update_form` n'acceptent plus `anonymous` ni `select_name`). Grille par defaut du
  pack `hackathon` : Result 90 + Quality of output 10 (a ajuster ; grilles FA26 : SPECS §4.2) ; `customer_day` / `traction_sprint` sans tirage ni formulaire. Anciens formulaires anonymes et Picks toujours lus. Les picks deja
  donnes : section « Picks (archived) » de la page d'admin de l'evenement (`AdminContext.eventIdsWithPicks`, aucun
  ecouteur sans eux) et reseau de `founderStats` ; plus de section Picks dans le To do. Bareme : seulement des
  criteres du jury avec leurs points ; un element `per_unit` / `proportional` (`isLegacyScoringItem`) se garde tel
  quel, se calcule, se deplace ou se retire, jamais ne s'ajoute ni ne change (`scoringProblems(..., stored)`,
  `newLegacyItemProblems`, `setEventScoring`) ; « Copy scoring from » ne propose pas un bareme qui en a.
  `zeroedItemKeys` (ancienne verification des preuves) : lu, plus pose. Elo : `readFounderInternal` (types/founder.ts)
  le retire de ce que rend l'API.
  H5 (17/11) : pas de `debrief` mais trois formulaires d'equipe sur la MEME Submission (`h5_plan`, `h5_snapshot`,
  `h5_final`, data/events.json `withoutForms` / `forms`) ; seul un formulaire `setsSubmissionLate` (Final numbers,
  Submissions H1 a H4 ; absent = oui) marque la Submission en retard (une information : elle compte, regle du 0 retiree le 18/11). Tirage `matching.lockedTeamsFromStartups` :
  les startups du batch (deux fondateurs presents au moins) sont des equipes verrouillees, les autres sont tires.
- **Formulaires publics** (`/forms/[formId]`, une question par ecran : `components/forms/TypeForm` ; formulaire a
  portee : `components/forms/FormSheet`, une page) : callables `getPublicForm` (noms du batch en nom court ; avec
  `respondent`, ses cibles et, identite prouvee, ses reponses deja donnees `prefill`) et `submitFormResponse`
  (`services/forms.ts`, id de reponse deterministe par envoi, ecritures via `planFieldWrites` en mode partiel,
  groupees par cible). Portee d'une question (`scope`) : `self`, `team` (equipe publiee du repondant, une reponse
  commune), `each_teammate`, `each_target` (equipes notees sauf la sienne) ; reponse par cible sous
  `question@cible`, cibles calculees par le serveur. Identites : `account` (connexion obligatoire, defaut,
  `email_code` = ancien nom), `jury_link` ; `select_name` et `anonymous` retires le 17/11 (`RETIRED_IDENTITY_CHECKS` :
  ni proposes, ni recopies par `duplicate_form` / Copy, toujours lus). `formResponses` : staff seulement.
- **Jury** : le formulaire de jury de l'evenement (identite `jury_link`), par UN lien partage
  `/forms/{formId}#secret`, sans compte (decision du 12/11) ; secret en clair dans `events/{id}/judges/link` (staff
  seulement, recopiable ; `resetJuryLink` le remplace). Le jure choisit son nom (invites, noms deja venus noter,
  fondateurs du batch en nom court, aucun email) ou le saisit (`services/jury.ts`) : id `founder-{founderId}` ou
  `jury-{empreinte du nom normalise}` ; un fondateur ne voit pas sa propre equipe. Verrou = formulaire ferme ;
  `deleteJuryScore` supprime une note (entiere dans l'audit). Staff : Admin > Events > evenement
  (Forms, Jury). Feuille papier : ouvrir le lien connecte, taper le nom.
  Ce que lit le jure (18/11, `loadJuryBrief` -> `JuryBrief`, `components/forms/JuryBrief.tsx`) : la cible et ses membres, puis
  `blocks` = un bloc par formulaire de l'evenement qui ecrit dans les documents de la cible (equipe : Submission ; startup :
  Submission, fiche), TOUTES les questions, sans reponse = `text: null` (« Not answered »), Drive a part ; puis les chiffres
  de toutes les cibles classes (`shared/juryBrief.ts#briefMetricRanks`, ex aequo 1, 2, 2, 4) ; sous chaque critere
  `evaluation.scores.<k>` dont `k` est une metrique declaree (`criterionMetrics`), la valeur, la place et la meilleure.
  `submissions[id].answers` (liste plate) reste pour les clients d'avant.
- **Series des indicateurs** : declencheurs Firestore `onCheckinWritten` (`checkins/{id}`) et `onStartupUpdated`
  (`startups/{id}`, equipe changee), en **europe-west9** (region de la base, exigee pour un declencheur Firestore).
  Tout ecrivain d'un update du jeudi est couvert. Regle pure `shared/kpis.ts#planStartupKpis` : par indicateur
  (`checkin.*` a `indicator`) et par semaine, le MAXIMUM entre fondateurs (SPECS §12 q7) -> `kpiSeries/{startupId}`
  et un releve `metricSnapshots/{startupId}_{metric}_{lundi}` (`self_reported`, `sourcePath` = l'update du maximum).
  Un releve d'une autre source au meme id n'est jamais touche. Rattrapage :
  `node scripts/backfill-kpis.mjs <batchId> [--prod]` (a blanc sans `--prod` ; emulateurs avec `FIRESTORE_EMULATOR_HOST`).
  Resultats d'equipe et jury, quel que soit l'ecrivain (Debrief, staff, API) : `onSubmissionWritten` (releves
  `metricSnapshots`, source `recordedSource` de la soumission, puis leaderboard, `services/teamResults.ts`) et
  `onEvaluationWritten` (leaderboard), en europe-west9. `onFormWritten` (`forms/{id}`) recalcule le leaderboard quand
  la grille du jury ou les metriques d'un formulaire changent (pas pour une date, un statut, un titre).
  `onTeamWritten` (`events/{id}/teams/{teamId}`, 19/11) : une equipe d'un tirage PUBLIE dont les membres ou le nom
  changent (absent retire, retardataire, echange : ecran Admin ou `edit_teams`) recalcule le leaderboard, qui copie
  ses `memberIds` ; un brouillon, rien. Une absence marquee ne retouche jamais un tirage publie.
  Classement de startups (pitchs, sans matching) : `onStartupUpdated` recalcule aussi les leaderboards des evenements
  non archives qui la classent quand son nom ou son equipe change ; `onEventUpdated` (`events/{id}`) recalcule quand
  ses `startupIds` ou son matching changent (bareme et metrique : deja par leurs callables). Verifie par `check:api`
  (MCP, REST et ecriture directe comme l'ecran Admin).
- **Jamais lus par l'API** : `peerRatings`, `picks`, `judges`, `apiKeys`, `writePlans`, `founders/*/private/connections`, `shortlistHistory`
  (SPECS §4.8 ; `draw_teams` lit les connections pour tirer, sans les rendre). **Staff seulement par l'API** : `teamLocks`, `founderReviews`,
  `startupReviews`, les notes du jury une par une, `formResponses` (jamais ceux d'un formulaire d'avis ou de picks, ni leurs valeurs ailleurs).
  Avis, picks et notes du jury ne s'ecrivent que par leur formulaire (`DOC_KINDS[...].formOnly`, refus `form_only`), avec UNE exception
  (18/11) : `score_jury` (staff), toutes les notes d'un jury en une fois, apercu en table, puis envoi PAR le formulaire de jury
  (`submitFormResponse(..., { fullName })`, sans le secret du lien) sous le nom complet du staff : le meme jure que par le lien
  (`jury-{empreinte}`, une seule voix), justification par critere dans `evaluation.comment`, reponse `recordedVia: "mcp"`. Fiche de
  notation `pioneers_get` `jury_sheet` = ce que lit un jure + la grille (shared/admin/jury.ts) + le suivi du staff (`loadJuryFollowUp`, 19/11) : `status` par cible (`to_score` tout rempli, `incomplete` avec `owes` = formulaire du et NOMS, `waiting` = un formulaire a venir l'attend, `no_submission`, `scored`), `summary`, `formsNotOpenYet` ; le brief du jure reste en comptes.
- **OAuth 2.1** (`functions/src/oauth`, connecteur claude.ai et Claude Code) : decouverte RFC 9728 / 8414, enregistrement
  dynamique, `/oauth/authorize` -> page front `/oauth/consent` (callables `oauthDescribeRequest` / `oauthDecide`),
  `/oauth/token` avec PKCE S256. Acces 1 h, rafraichissement 30 j a rotation ; un code ou un rafraichissement rejoue
  revoque l'autorisation. Secrets stockes par empreinte. Qui peut accepter : `canUseApi` (shared/access.ts), la regle
  de l'API. Hosting a une reecriture explicite `/.well-known/**` (l'emulateur ne passe pas les chemins a point par `**`).
- Adresse a donner a Claude : `https://pioneers-hub-api.web.app/mcp`.
- **Calendrier d'un batch** : `GET /calendar/{batchId}.ics`, public (les evenements le sont), iCalendar construit par
  `shared/calendar.ts` ; seuls les evenements publies ouverts a tout le batch (`isBatchCalendarEvent`) : les rendez-vous
  a audience restreinte (office hours...) n'y sont pas. A l'ecran, `EventsContext` les montre a leurs seuls invites
  (`shared/access.ts#canSeeEvent`, appliquee aussi par l'API), au staff et aux investors. Filtre d'affichage
  seulement : la regle `events` laisse tout lire (listes d'invites comprises).
  Cache CDN 10 min, `DTSTAMP` = derniere modification (ETag stable, 304). Bouton « Add to calendar » de l'onglet
  Calendar du batch (abonnement Apple / Google / Outlook, `components/event/AddToCalendar.tsx`).
- Spec OpenAPI 3.1 publique `GET /v1/openapi.json` (`api/openapi.ts`), tiree des memes contrats zod ; seule reponse
  cachee au CDN. Adresses publiques et longueur du nom de cle : `shared/api.ts`. Table des types REST : `REST_OBJECTS`.
- Page `/api-docs` (menu du compte, `canUseApi`) : brancher Claude, creer / revoquer ses cles (`ApiKeysContext`),
  reference de l'API. Le menu du compte a aussi « Me » (profil fondateur du dernier batch rattache).
- **Actions de l'Admin** (17/11) : chaque geste de l'Admin est une `Operation` nommee de `services/actions.ts`
  (`services/admin/*.ts`), servie par UN outil MCP `pioneers_run` (`list actions` donne les arguments) et
  `POST /v1/actions/{action}`. Le geste se calcule UNE fois en logique pure dans `shared/admin/*.ts` (liste de
  `DocWrite`, `shared/docWrites.ts`) : le front l'execute en lot (`lib/firestore/write.ts#commitWrites`), l'API dans sa
  transaction (`services/admin/writes.ts#applyWrites`). Modifier un geste de l'Admin = modifier `shared/admin`, puis
  `check:api`. Actions hors transaction (comptes Firebase Auth, synchro de l'agenda, recalcul des scores) : `effect`
  d'`OperationPlan`, execute apres la transaction de verification (plan `applying`), service des callables reutilise
  (ses `HttpsError` deviennent des erreurs HTTP, `api/errors.ts`). Jamais par l'API : donner / retirer le role staff,
  bloquer un compte staff (injection de consignes via un texte de fondateur), ecrire un score (on corrige l'entree
  puis `recompute_scores`). Parite avec l'Admin (19/11) : `create_founders` (Import founders, regle
  `shared/admin/founders.ts#newFounderWrites`), `set_founder_staff_fields` (one-liner, id Slack : `slackUserIdWrites`, aussi
  utilise par l'ecran), `set_founder_photo` (URL d'image -> 800 px dans Storage + vignette 128 px, `services/photos.ts`, `sharp`
  dans functions), `create_set_password_link`, `refresh_team_names`, Slack du batch dans `update_batch` ; `search` filtre tous
  les types de `list` (`read.ts#matcher`). Tirage : `draw_teams` est REJOUABLE (`seed`, aleatoire `shared/admin/teams.ts#seededRandom`) : l'apercu montre ce que la confirmation ecrit ; il lit les `private/connections` comme TeamGenerator et n'en rend que des comptes. Plans et cles d'idempotence stockent entree, apercu et resultat en JSON (Firestore refuse un tableau de tableaux) ; l'audit aussi (`storable`). `list actions` : noms et descriptions ; arguments d'une action avec `search`.
- **Guide de l'agent** : outil `pioneers_guide` (`mcp/guide.ts`, staff) : modele, evenements, formulaires, scores,
  vie privee, recettes de correction. En anglais, aucun chiffre ; a tenir a jour avec les actions.
- Catalogue MCP : 9 outils pour le staff (~3 600 jetons ; 48 actions derriere `pioneers_run`), 4 pour un fondateur, 3 pour un investor. Une capacite de
  plus = un type d'objet dans `list` / `get` ou une action de `pioneers_run`, jamais un nouvel outil. Pas de valeur
  chiffree dans `mcp/instructions.ts`.
- `MCP-Protocol-Version` inconnu : retire avant le transport (panne totale vecue chez Trippple).
- URL publique : `api/config.ts` (`PUBLIC_BASE_URL`), jamais l'en-tete `Host`.

## Les types : `functions/src/shared/` est la source de verite

- `shared/types/` : un fichier par entite, reflet exact des documents Firestore.
  Import : `import type { Founder } from "@shared/types"`.
- `shared/collections.ts` : noms des collections, sous-collections, ids deterministes.
- `shared/access.ts` : qui voit quoi, en logique pure. **Miroir de `firestore.rules`** :
  modifier l'un, c'est modifier l'autre (puis `npm run check:rules`).
- `shared/callables.ts` : contrat nom -> `{ req, res }` de chaque callable.
- `shared/presets/eventTemplates.ts` : modeles d'evenements = packs (etiquette, duree, heure, matching, formulaires ;
  grille et metriques PAR DEFAUT de ses formulaires). Le type d'un evenement est une ETIQUETTE (`team_challenge`,
  `pitch`, `matching`, `session`, `meeting`) : rien ne se decide sur lui (voir « Evenement = point d'entree »). `shared/presets/formTemplates.ts` : modeles de formulaires (Submission, Jury
  construits depuis l'evenement, `build`). `shared/eventForms.ts` : les formulaires d'un evenement (import, migration).
- `shared/events.ts` : LA construction d'un document `events` (`newEvent` : Admin > Events, outils de tirage,
  scripts/import-events.mjs) et ce que voient les fondateurs (`isPublishedEvent`). Admin > Events
  (`/admin/events`) : creer (en brouillon), regler, archiver / restaurer (`lib/eventsAdmin.ts`, ecriture staff directe).
  Presence : `/admin/events/{id}/attendance` (`AttendanceSheet`, `lib/attendanceAdmin.ts`) ; present par defaut, le
  premier geste enregistre tous les attendus. LA regle : `shared/attendance.ts` (`eventRoster` : attendus, statuts,
  non marques ; `absentFounderIds`). Un absent sort de l'audience des formulaires (`formRules` `addressees`, To do du
  fondateur, qui lit SA presence : regle `isOwnFounder`), du tirage (TeamGenerator), de la liste des noms et des choix
  de fondateurs (`getPublicForm`), et un pick qui le vise est refuse (`submitFormResponse`).
- `shared/presets/standardMetrics.ts` : LE dictionnaire des metriques du pipeline et de la traction (SPECS annexe A.5) :
  une notion = une cle, la meme dans `checkin.*` et `submission.metrics.*`. Flux = participe passe (`callsMade`),
  total = sans (`totalUsers`, `mrr`). Anciennes cles : `EVENT_METRIC_RENAMES`, `CHECKIN_FIELD_RENAMES`.
- `shared/fieldRegistry.ts` : registre des champs ecrivables par formulaire, import ou MCP (`dbField`), avec deux
  familles a cle libre et stable : `submission.metrics.<cle>`, `evaluation.scores.<cle>` (ecrites imbriquees).

Regles de `shared/` : jamais d'import de `firebase`, `firebase-admin` ou de Node.
Aucune date en `Timestamp` : `dayString` (`YYYY-MM-DD`) ou `dateISOString` (ISO complet),
suffixe dans le nom du champ (`startDayString`, `createdDateISOString`).

Un champ vit dans le document qui correspond a sa visibilite (Firestore autorise un
document ENTIER, jamais un champ) :

| Document | Qui lit |
|---|---|
| `founders/{id}` | public (toutes les fiches, sans consentement : decision du 17/11) |
| `founders/{id}/private/directory` | fondateurs du batch + staff + investors (champs du Profile Book) |
| `founders/{id}/private/profile` | le fondateur lui-meme + staff + investors IC (age, date de naissance) |
| `founders/{id}/private/connections` | le fondateur lui-meme + staff + investors IC (shortlist, met ; ecrit par lui seul, jamais par le staff ni l'API) |
| `batchTasks/{id}` | fondateurs du batch + staff + investors (taches du To do, ecrites par le staff, archivees) |
| `taskCompletions/{taskId}_{founderId}` | le fondateur lui-meme + staff (sa coche, ecrite par lui seul ; decocher = `done: false`) |
| `formCompletions/{formId}_{founderId}`, `picks` | le fondateur lui-meme + staff (« J'ai repondu » et picks, ecrits par `submitFormResponse` ; jamais pour un formulaire anonyme) |
| `founders/{id}/private/internal`, `founderStats`, `notes`, `assessments`, `eloMatches` (archive) | staff + investors IC |
| `shortlistHistory/{founderId}_{targetId}` | staff (SPECS §6.2 ; ecrit par le serveur seul, jamais lu par l'API) |
| `teamLocks/{founderId}` | le fondateur lui-meme + staff (SPECS §6.2 ; reponse a Lock my team, ecrite par `submitFormResponse`, corrigee par le staff ; par l'API : staff seulement) |
| `founderReviews/{founderId}_{lundi}`, `startupReviews/{startupId}_{lundi}` | staff (SPECS §6.2 ; revue des Weekly updates, ecrite par le staff ; jamais montree aux fondateurs ; par l'API : staff seulement) |
| `startups/{id}` | public |
| `startups/{id}/private/profile`, `kpiSeries` | membres + staff + investors |
| `startups/{id}/private/internal` | staff + investors IC |
| `scores/*` (sous-scores, ponderes a l'affichage), `scoreSignals/*` | public (open data, 18/11) ; l'ecran suit `settings.scoresVisibility` (`shared/access.ts#canSeeScores`, Admin > Batch settings : none / staff (+ investors) / founders) ; signaux bruts pour staff et investors, phrase simple pour les fondateurs (`components/insights/ScoreSignalList.tsx`) |
| `events/{id}` | public, listes d'invites comprises (`canSeeEvent` ne filtre que l'affichage) |
| `events/*/peerRatings`, `events/*/judges`, `formResponses`, `apiKeys`, `auditLogs` | staff (l'auteur relit ses avis donnes) |

Rattachement d'un compte (SPECS §3.1, `lib/accounts.ts`) : a la connexion, l'accueil (`app/(app)/page.tsx`)
essaie l'email VERIFIE du compte contre `people.email` / `altEmails` et rattache en un lot
(fondateur, `batchMemberships`, personne, compte) ; les regles verifient le lot. Sinon `/claim`
(« comme Tricount », decision du 11/11) : le compte choisit son batch puis un profil non reclame,
et il est rattache tout de suite (`claimProfile`). Email verifie obligatoire, un profil par batch.
Le staff voit chaque rattachement dans Admin > Founder profiles (`/admin/profiles`, par batch) et peut lier ou delier ;
delier libere aussi la personne et le compte s'il n'en tient plus rien (aucun autre profil, ni fiche mentor ou investor :
`lib/accounts.ts#unlinkFounder`). `claimRequests` (ancienne validation par le staff) : plus rien ne les cree, aucune en base.
Le fondateur modifie lui-meme les champs de `FOUNDER_SELF_EDITABLE` (shared/access.ts, miroir
des regles `update`) ; WhatsApp et LinkedIn s'ecrivent dans `people` ET leur copie, en un lot.
WhatsApp est obligatoire (15/11). `founderDirectory.education` est une LISTE (15/11, une ecole ou un diplome par entree ; une
ancienne valeur texte est decoupee a la lecture par `readDirectory` (shared/types/founder.ts) : convertisseur de
`refs.founderDirectory`, `services/read.ts`, `services/fields.ts` ; separateurs `;` et ` · ` declares dans le registre).

Roles : `users.roles` (`staff`, `investor`, `mentor`, cumulables) et `users.investorAccess`
(`ic` ou `portfolio`), ecrits par le staff seulement. Un visiteur est fondateur d'un batch
si `batchMemberships/{batchId}_{uid}` existe. Role dans un batch (`roleInBatch`) :
`staff` > `investor_ic` > `investor_portfolio` > `founder` > `public` ; un mentor n'a pas
d'acces en v1. « View as » du staff (16/11, `lib/viewAs.ts`, switch `_chrome/ViewAsSwitch.tsx`) : BatchContext
remplace `role` / `viewerFounderId` et SEUL lui lit le store ; sous un batch, lire `useBatch()` (`isSignedIn`,
`canViewAs`), jamais `useAuth()` pour une decision de role, sinon l'apercu ne suit pas. Collections a plat avec `programId` / `batchId`.

## L'arbre : un niveau = un dossier = un layout = un Provider

| Niveau | Layout | Provider | Type |
|---|---|---|---|
| Visiteur | `app/providers.tsx` | `context/AuthContext.tsx` | `User`, `Viewer` |
| Programmes | `app/(app)/programs/layout.tsx` | `ProgramsContext` | `Program` |
| Programme | `programs/[programId]/layout.tsx` | `ProgramContext` (+ ses batchs) | `Program`, `Batch` |
| Batch + role | `.../batches/[batchId]/layout.tsx` | `BatchContext`, `FoundersContext`, `StartupsContext` ; pour le visiteur fondateur (cible `null` sinon) : `MyConnectionsContext` (sa shortlist / ses rencontres : liste, grille, fiches, SA fiche) et `TasksContext` (taches du batch + ses coches, `hooks/useBatchTasks`) | `Batch`, `BatchRole` |
| Fondateur | `.../founders/[founderId]/layout.tsx` | `FounderContext` | `Founder`, `FounderDirectory`, `FounderProfile`, `FounderInternal` |
| Annuaire (grille) | `.../founders/layout.tsx` | `FounderDirectoriesContext` (grille par defaut, liste au choix ; `private/directory` de chaque fondateur a la premiere visite de Founders : la page appelle `ensureOpen`) | `FounderDirectory` |
| Startup | `.../startups/[startupId]/layout.tsx` | `StartupContext` | `Startup`, `StartupProfile`, `StartupInternal` |
| Batch (suite) | idem batch | `EventsContext`, `ListsContext`, `CohortContext` (batchStats + scores), `LeaderboardsContext` | `PioneersEvent`, `ClosedList`, `BatchStats`, `Score`, `Leaderboard` |
| Moi | `.../(mine)/layout.tsx` (groupe de `me/` et `todo/`) | `MeGate` -> `FounderContext` (id du rattachement) + `FormsToFillContext` (formulaires qui me restent : audience `formConcernsFounder`, `formCompletions`, anciens anonymes retenus par le navigateur ; un formulaire rempli depuis son compte reste modifiable tant qu'il est ouvert)  (via `TodoProviders`) ; `TasksContext` (layout du batch) ; `hooks/useTodoItems` les range (18/11 : des TACHES seulement, aucun evenement ; `toDo` ouvert par echeance, fait = barre le jour meme puis parti le lendemain (date exacte : la coche, l'envoi du formulaire, `private/directory.profileCompletedDateISOString` posee par l'enregistrement ou la photo qui complete le profil, `private/connections.shortlistDoneDateISOString` posee par l'ajout qui amene la shortlist a 5 ; regles : le fondateur les ecrit ; sans date : parti), cercle a droite (`TodoRows`), `comingUp` = ce qui ouvre dans les 7 jours, `shared/tasks.ts#todoWindow` ; profil calcule, taches du batch avec `opensDateISOString` / `deadlineDateISOString` et `check` (verifiee par l'app, sans coche : `shared/tasks.ts#isTaskDone`, `shortlist` = 5 autres fondateurs du batch dans sa shortlist ACTUELLE, `SHORTLIST_TASK_MIN` ; la milestone Shortlist done du score reste a 3 et compte aussi l'historique), formulaires : page To do, resume en haut de SA fiche). « Me » = sa fiche `/founders/{son id}` (`founders/[founderId]/layout.tsx` monte les memes Providers via `SelfProviders` quand c'est la sienne) ; `/me` et `/me/edit` ne font que rediriger | |
| Admin | `app/(app)/admin/layout.tsx` | `AdminContext` (garde : role `staff` ; batch de travail choisi par `BatchPicker`, retenu sur le compte ; demandes de rattachement en attente, tous batchs) ; Admin > Tasks : `AdminTasksContext`, `lib/tasksAdmin.ts`, attendus = `isBatchParticipant` | `Batch`, `Founder`, `PioneersEvent`, `Form`, `ClaimRequest` |
| Rattachement | `app/(app)/claim/layout.tsx` | `ClaimContext` | `Founder`, `ClaimRequest` |

Regles :

1. **Le layout monte, la page lit.** Une page appelle `useBatch()`, `useFounder()`... et ne
   lit jamais Firestore elle-meme. Les layouts restent des composants serveur.
2. **Un Provider se monte au plus haut niveau qui le consomme** : ses ecouteurs survivent
   aux navigations (les listes du batch sont au layout du batch, pas sous `/founders`).
3. **Un Provider de niveau passe par `LevelGate`** : chargement, puis document introuvable ou
   refuse. Sous lui, le document n'est jamais nul (`useFounder().founder`).
4. **Le role se calcule une fois, au batch** (`useBatch().role`) ; les niveaux en dessous le
   lisent. On n'ouvre pas d'ecouteur que les regles refuseraient : cible `null`.
5. **Ecouteurs via `useDocListener` / `useQueryListener`** (`useDocsListener` : un document par id, quand une requete de groupe ne passe pas les regles) : `undefined` = on attend une
   dependance, `null` = pas le droit, ref = on ecoute. Requetes nommees dans
   `lib/firestore/refs.ts` (`queries.*`, avec une `key` stable).
6. **Les contextes ne font que lire.** Ecritures : `lib/firestore/write.ts`, ou une callable
   si la donnee doit etre validee (`call("nom")`, typee par `shared/callables.ts`).
7. **Contextes stricts** (`createStrictContext`) : un hook appele hors de son Provider leve
   une erreur au lieu de rendre une valeur par defaut.
8. **Chemins** : routes dans `lib/paths.ts`, chemins Firestore dans `lib/firestore/refs.ts`.
   Nulle part ailleurs.

## Next 16 : pieges rencontres

- `useParams` / `usePathname` / `useSearchParams` suspendent au pre-rendu (`cacheComponents`) :
  une frontiere `Suspense` est posee dans `app/(app)/layout.tsx` ; tout composant qui les
  utilise HORS de cet arbre a besoin de la sienne.
- La validation « instant navigation » est en `manual-warning` (next.config.ts) : les donnees
  sont client, une navigation attend sa premiere reponse par conception.
- `LayoutProps<"/route">` est genere : apres une nouvelle route, `npx next typegen`.

## Interface : mobile d'abord (decision du 11/11)

**Regles d'ecran : `docs/UI-RULES.md` (17/11), a lire avant toute modification d'ecran** : echelle
d'espacement (12 px entre cartes soeurs, partout), surface `.card`, une couleur par champ pour les tags
(`TAG_KIND_COLOR`), liens soulignes, memes etats survol / appui / focus pour tout element cliquable
(`.state-layer`), onglet actif et retour nommes, rien de repete, explications repliees derriere un (?) (`PageHeader` / `Section`
`help`, `WithHelp`, `components/ui/Help.tsx`). Verifier par captures (390 et 1 280 px).

- Theme sombre force, bleu `#0DB0F5` reserve a l'element actif et a l'action principale ; bleu clair
  `pioneers.3` (`#5fcaf7`) pour les titres de section (decision du 15/11).
- Typographie (15/11) : Eina 04 Light pour le texte, Eina 04 SemiBold pour les titres et tout ce qui est en
  gras, IBM Plex Mono pour les sur-titres en capitales (`.label`). Fichiers dans `app/fonts/`, branches par
  `next/font/local` (`app/layout.tsx`) et `theme.ts`. Eina Regular et Medium MANQUENT : les `@font-face`
  couvrent des plages (Light jusqu'a 400, SemiBold a partir de 500), donc deux graisses visibles seulement
  (un `fw={500}` s'affiche en SemiBold). Licence web Eina (Textaxis) a confirmer avec Pioneers ; TTF a convertir en woff2.
- Minimaliste : du texte, des filets, peu de cadres. **Pas d'icone** sauf manque de place, aide repliee (?) ou
  NAVIGATION (17/11, `docs/UI-RULES.md` §9) : `>` au bout d'une ligne ou d'une carte qui mene a une page (`NavChevron`,
  pose par `LinkRow`, `CardLink` et `ButtonRow opens` qui ouvre une fenetre), `↗` pour un autre site (`ExternalLinkRow`), `v` de depliage qui se retourne
  une fois ouvert (`ExpandChevron`, `ButtonRow` des `expanded`), `<` de retour (`BackButton`). **Jamais d'emoji**.
- Aucune table : des lignes empilees (`components/ui/Rows.tsx` : `LinkRow`, `ButtonRow`, `Row`, `ActionRow` = bouton a droite hors du lien),
  cibles tactiles de 60 px. Titres : `PageHeader` ; blocs : `Section` (filet au-dessus, titre bleu clair
  16 px) ; titre de section ecrit a la main : `SectionTitle` (meme fichier), jamais un `.label` ; titre d'un bloc dans une
  section (cadre de graphique, liste) : `SubsectionTitle` ; valeurs :
  `Field` (masque si vide ; son libelle `.label` est gris, partout, cartes comprises : 17/11).
- Retour : `PageHeader` `back`, ou `BackButton` (meme fichier) hors en-tete : bouton gris leger avec chevron,
  40 px. Jamais un lien texte « All founders ».
- Dans un batch : onglets en bas sur mobile (64 px, texte 15 px, jusqu'a 5 onglets en 390 px), en haut des
  48em (16 px, 48 px de haut) (`BatchShell`, `.tabbar` / `.toptabs`, `--tabbar-height`). Pas d'icones. Les onglets
  dependent du role (fondateur : To do, Me). Aucun onglet staff : TOUS les outils du staff sont dans
  `/admin` (decision du 13/11) : Access (comptes), Founder profiles, Events, Forms, Tasks, Import founders, Batch settings,
  et (17/11) Startups (reponses a Lock my team, `teamLocks` -> startups creees en un lot, shared/teamLocks.ts),
  Background (grille du staff dans `private/internal.background`, proposition de Claude pre-remplie), Edge (18/11 : note 0-5
  de l'edge ecrit par chaque fondateur, `private/internal.edge`), Reviews (revue
  des Weekly updates par semaine : `founderReviews` oui / non, `startupReviews` Traction et Progress sur 5).
  Onglets : Home, Founders, Calendar (+ To do, Me). Pas de titre de page sous un onglet (16/11, place verticale) :
  nom et dates du batch dans la ligne du haut de `BatchShell` (dates masquees sur mobile) ; compteur d'une liste dans sa recherche
  (`components/ui/SearchCount.tsx`) ; « Add to calendar » en bas de Calendar ; une `Section` en tete de son
  conteneur n'a ni marge ni filet (`.section:first-child`, `globals.css`). L'onglet Startups et sa tuile suivent `settings.startupsVisibility`
  (18/11, `shared/access.ts#canSeeStartupsTab`, Admin > Batch settings ; absent = personne) ; la section Milestones de l'accueil reste masquee par drapeau (`lib/features.ts`).
- Champs de saisie en 16 px (sinon iOS zoome) : taille `md` par defaut (theme.ts). Boutons
  d'action principaux `size="md"`, pleine largeur sur mobile ; enregistrement dans `.savebar`.
- Verifier en 390 px de large : aucun debordement horizontal.
- Cibles tactiles >= 40 px : boutons en `md` par defaut (theme), lien isole (email,
  site) avec `className="tap-link"`, ligne entiere cliquable plutot qu'un lien dans une ligne
  (`LinkRow`, `ExternalLinkRow`). Choix courts : `SegmentedControl` plutot qu'un `Select`.
- Fenetres : `ResponsiveDialog` (feuille du bas sur mobile, fenetre centree sinon), jamais
  `Modal` directement. Menu du compte : feuille du bas sur mobile, menu deroulant sur ordinateur.
- **Rien ne depend du survol.** Une information s'obtient au toucher (ou est affichee) ; le
  survol n'ajoute qu'un retour visuel, en CSS sous `@media (hover: hover)`. Pas de
  `onMouseEnter` qui change ce qui s'affiche.
- Graphiques : `components/charts/` (reprise des graphiques du dashboard Spring 2026), sur
  `@mantine/charts` (recharts) et `d3-geo` pour la carte. Couleurs du theme via `CHART_COLORS`,
  cadre `ChartCard`. Galerie avec donnees fictives : `/charts`. Notes sur 5 en segments
  (`RatingDots`), pas en etoiles.

## Conventions

- Interface en anglais (equipe Pioneers), commentaires et docs en francais.
- Polices : Eina 04 (Light / SemiBold) et IBM Plex Mono sur `.label` (voir Interface). Chiffres en colonnes :
  `className="num"` (tabular-nums, dans la police du texte).
- Rien n'est supprime : on archive (`archivedDateISOString`).
- Donnees de test : personnes fictives uniquement, emulateurs uniquement.
