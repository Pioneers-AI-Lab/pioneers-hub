@AGENTS.md

# Pioneers Hub

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
npm run dev:emu       # app sur les emulateurs (ignore .env.local)
npm run check:rules   # emulateurs + seed + verification des regles role par role (code de sortie)
npm run check:api     # API /v1 + MCP de bout en bout, emulateurs decales de +200 (tourne a cote de `emulators`)
npm run deploy:rules  # regles + index Firestore sur le projet reel (apres check:rules)
npm run init:prod     # documents de depart du projet reel (rejouable, n'ecrase rien)
npm run grant -- <email> staff|investor ic|investor portfolio|mentor|none   # role d'un compte, reel
node scripts/import-sp26.mjs <bundle.json> --prod   # import du batch Spring 2026 (paquet hors depot, donnees personnelles)
node scripts/import-fa26.mjs <lien-airtable> --prod [--dry-run]   # batch Fall 2026 depuis la vue partagee du Profile Book (lien hors depot)
node scripts/import-events.mjs "Week 1" [--prod]   # evenements de data/events.json ET leurs formulaires (a blanc sans --prod, n'ecrase jamais)
node scripts/migrate-standard-forms.mjs <batchId> [--prod]   # modele standard : anciens metrics/criteria/picks -> formulaires (a blanc sans --prod)
node scripts/migrate-metric-keys.mjs <batchId> [--prod]   # cles de metriques standard (SPECS A.5), a blanc sans --prod ; puis backfill-kpis.mjs
npx firebase deploy --only storage --project prod   # regles Storage (tout refuse : lecture par URL a jeton)
npm run typecheck     # route types + front + functions
npm run lint
npm run build
```

Projet reel : `pioneers-3627c` (alias `prod` dans .firebaserc ; `default` reste le projet de demo,
un `firebase deploy` sans `--project prod` ne touche donc rien). Firestore est en `europe-west9`
(Paris), pas en `eur3`. Les scripts admin utilisent les Application Default Credentials.
Cloud Functions : deployees le 11/11 (`api`, `health`, `createApiKey`, `revokeApiKey`, `oauthDescribeRequest`, `oauthDecide`,
europe-west4) avec le site Hosting
`pioneers-hub-api` : `npx firebase deploy --only functions,hosting --project prod`. Images de conteneur purgees apres 1 jour.
Un seul `next dev` par dossier (Next 16) : arreter `dev:emu` avant `dev`, et inversement. Pour
verifier un build a cote d'un `next dev` : `NEXT_DIST_DIR=.next-emu next build` puis
`NEXT_DIST_DIR=.next-emu next start` (Next ajoute alors `.next-emu` au tsconfig : ne pas le commiter).

Donnees : batch `spring-2026` (termine) importe du dashboard spring2026.thepioneer.vc (ids Airtable,
reimport sans perte des rattachements). Batch `fall-2026` importe le 12/11 de la vue partagee
« Pioneers Profile Book - FA26 » (32 fondateurs, ids Airtable, sans email : rattachement par /claim).
Noms affiches des batchs : `fa26` et `sp26` (comme sur Slack) ; les ids restent `fall-2026` / `spring-2026`.
Evenements de la semaine 1 importes le 12/11 (id = `key` de data/events.json ; sans heure connue : brouillon a 09:00, masque aux fondateurs).
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
- **Evenement = point d'entree** (SPECS §2, decision du 13/11) : son type (`kind`) n'est qu'une ETIQUETTE ; les
  outils viennent de ce qui est attache : `event.matching` (0 ou 1 : mode `challenge` = equipes, `matching` = tables,
  taille ; groupes dans `teams`) et ses formulaires. Un evenement d'avant sans le champ le deduit de son type et de
  `teamSize` : TOUJOURS lire `matchingOf(event)` (shared/events.ts) ; cible du jury `juryTargetOf` (groupes du
  matching, sinon startups) ; leaderboard des qu'une grille de jury ou une metrique classe. Un modele
  (presets/eventTemplates.ts) est un PACK : evenement (etiquette, duree, heure) + matching + formulaires, crees ensemble
  (`eventFormsPlan` : publies si l'evenement est programme, brouillons sinon) par Admin > Events > New (blank |
  template, reglages facon agenda, « Create » / fleche « Create as draft », `lib/eventsAdmin.ts#createEventPack`),
  `create_event` et l'import. Staff : `/admin/events/{id}` = la page hub (reglages, presence, matching, formulaires,
  classement, resultats, jury, picks), `/admin/events/{id}/matching` (TeamGenerator), `/admin/events/{id}/teams/{teamId}`
  (resultats). `/admin/challenge-teams/**` et `/admin/lunch-roulette/**` redirigent. Tous : `/programs/…/batches/…/events/{id}`
  (`EventPageContext` : infos, mon groupe, formulaires a faire / fait / ferme, leaderboard) ; `EventRow` y mene.
  Page publique des groupes : `/groups/{id}` (`/lunch-roulette/{id}` et `/challenge-teams/{id}` montrent la meme).
- **Modele standard** (SPECS §2, decision du 12/11) : un evenement = une entree d'agenda + un tirage de groupes
  (`teams`) + des FORMULAIRES. Toute saisie passe par un formulaire rattache a l'evenement : le Debrief d'un
  hackathon (metriques = questions `submission.metrics.<cle>`, avis = `peerRating.*`), le jury
  (`evaluation.scores.<cle>`, poids sur la question), les picks (`picks.pickedFounderIds`). L'evenement ne porte
  ni `metrics` ni `criteria` ni `picks` (seulement `rankingMetricKey`) ; `shared/forms.ts#juryCriteria` /
  `eventMetrics` les relisent dans ses formulaires. Stockage type inchange (submissions, peerRatings,
  evaluations, picks). Formulaires d'un evenement crees par `shared/eventForms.ts` (import, migration) ou depuis
  sa page d'admin (modeles `debrief`, `jury`, `picks`, `founder_introductions`...).
- **Formulaires publics** (`/forms/[formId]`, une question par ecran : `components/forms/TypeForm` ; formulaire a
  portee : `components/forms/FormSheet`, une page) : callables `getPublicForm` (noms du batch en nom court ; avec
  `respondent`, ses cibles et, identite prouvee, ses reponses deja donnees `prefill`) et `submitFormResponse`
  (`services/forms.ts`, id de reponse deterministe par envoi, ecritures via `planFieldWrites` en mode partiel,
  groupees par cible). Portee d'une question (`scope`) : `self`, `team` (equipe publiee du repondant, une reponse
  commune), `each_teammate`, `each_target` (equipes notees sauf la sienne) ; reponse par cible sous
  `question@cible`, cibles calculees par le serveur. Identites : `select_name`, `account` (connexion obligatoire,
  `email_code` = ancien nom), `jury_link`, `anonymous`. `formResponses` : staff seulement.
- **Jury** : le formulaire de jury de l'evenement (identite `jury_link`), par UN lien partage
  `/forms/{formId}#secret`, sans compte (decision du 12/11) ; secret en clair dans `events/{id}/judges/link` (staff
  seulement, recopiable ; `resetJuryLink` le remplace). Le jure choisit son nom (invites, noms deja venus noter,
  fondateurs du batch en nom court, aucun email) ou le saisit (`services/jury.ts`) : id `founder-{founderId}` ou
  `jury-{empreinte du nom normalise}` ; un fondateur ne voit pas sa propre equipe. Verrou = formulaire ferme ;
  `deleteJuryScore` supprime une note (entiere dans l'audit). Staff : Admin > Events > evenement
  (Forms, Jury). Feuille papier : ouvrir le lien connecte, taper le nom.
- **Series des indicateurs** : declencheurs Firestore `onCheckinWritten` (`checkins/{id}`) et `onStartupUpdated`
  (`startups/{id}`, equipe changee), en **europe-west9** (region de la base, exigee pour un declencheur Firestore).
  Tout ecrivain d'un update du jeudi est couvert. Regle pure `shared/kpis.ts#planStartupKpis` : par indicateur
  (`checkin.*` a `indicator`) et par semaine, le MAXIMUM entre fondateurs (SPECS §12 q7) -> `kpiSeries/{startupId}`
  et un releve `metricSnapshots/{startupId}_{metric}_{lundi}` (`self_reported`, `sourcePath` = l'update du maximum).
  Un releve d'une autre source au meme id n'est jamais touche. Rattrapage :
  `node scripts/backfill-kpis.mjs <batchId> [--prod]` (a blanc sans `--prod` ; emulateurs avec `FIRESTORE_EMULATOR_HOST`).
  Resultats d'equipe et jury, quel que soit l'ecrivain (Debrief, staff, API) : `onSubmissionWritten` (releves
  `metricSnapshots`, source `recordedSource` de la soumission, puis leaderboard, `services/teamResults.ts`) et
  `onEvaluationWritten` (leaderboard), en europe-west9.
- **Jamais lus par l'API** : `peerRatings`, `picks`, `judges`, `apiKeys`, `writePlans` (SPECS §4.8). Avis, picks
  et notes du jury ne s'ecrivent que par leur formulaire (`DOC_KINDS[...].formOnly`, refus `form_only`).
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
  Cache CDN 10 min, `DTSTAMP` = derniere modification (ETag stable, 304). Bouton « Add to calendar » de l'accueil du
  batch (abonnement Apple / Google / Outlook, `components/event/AddToCalendar.tsx`).
- Spec OpenAPI 3.1 publique `GET /v1/openapi.json` (`api/openapi.ts`), tiree des memes contrats zod ; seule reponse
  cachee au CDN. Adresses publiques et longueur du nom de cle : `shared/api.ts`. Table des types REST : `REST_OBJECTS`.
- Page `/api-docs` (menu du compte, `canUseApi`) : brancher Claude, creer / revoquer ses cles (`ApiKeysContext`),
  reference de l'API. Le menu du compte a aussi « Me » (profil fondateur du dernier batch rattache).
- Catalogue MCP : 5 outils (~1 200 jetons). Une capacite de plus = un type d'objet dans `list` / `get`
  avant un nouvel outil. Pas de valeur chiffree dans `mcp/instructions.ts`.
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
  `pitch`, `matching`, `session`, `meeting`) : rien ne se decide sur lui (voir « Evenement = point d'entree »). `shared/presets/formTemplates.ts` : modeles de formulaires (Debrief, Jury, Picks
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
| `founders/{id}` | public si `publicProfileConsent`, sinon fondateurs du batch + staff + investors |
| `founders/{id}/private/directory` | fondateurs du batch + staff + investors (champs du Profile Book) |
| `founders/{id}/private/profile` | le fondateur lui-meme + staff + investors IC (age, date de naissance) |
| `formCompletions/{formId}_{founderId}`, `picks` | le fondateur lui-meme + staff (« J'ai repondu » et picks, ecrits par `submitFormResponse` ; jamais pour un formulaire anonyme) |
| `founders/{id}/private/internal`, `founderStats`, `notes`, `assessments`, `eloMatches` | staff + investors IC |
| `startups/{id}` | public |
| `startups/{id}/private/profile`, `kpiSeries` | membres + staff + investors |
| `startups/{id}/private/internal` | staff + investors IC |
| `scores/*` (sous-scores, ponderes a l'affichage) | staff + investors (IC et portfolio) |
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

Roles : `users.roles` (`staff`, `investor`, `mentor`, cumulables) et `users.investorAccess`
(`ic` ou `portfolio`), ecrits par le staff seulement. Un visiteur est fondateur d'un batch
si `batchMemberships/{batchId}_{uid}` existe. Role dans un batch (`roleInBatch`) :
`staff` > `investor_ic` > `investor_portfolio` > `founder` > `public` ; un mentor n'a pas
d'acces en v1. Collections a plat avec `programId` / `batchId`.

## L'arbre : un niveau = un dossier = un layout = un Provider

| Niveau | Layout | Provider | Type |
|---|---|---|---|
| Visiteur | `app/providers.tsx` | `context/AuthContext.tsx` | `User`, `Viewer` |
| Programmes | `app/(app)/programs/layout.tsx` | `ProgramsContext` | `Program` |
| Programme | `programs/[programId]/layout.tsx` | `ProgramContext` (+ ses batchs) | `Program`, `Batch` |
| Batch + role | `.../batches/[batchId]/layout.tsx` | `BatchContext`, `FoundersContext`, `StartupsContext` | `Batch`, `BatchRole` |
| Fondateur | `.../founders/[founderId]/layout.tsx` | `FounderContext` | `Founder`, `FounderDirectory`, `FounderProfile`, `FounderInternal` |
| Annuaire (grille) | `.../founders/layout.tsx` | `FounderDirectoriesContext` (mode liste / grille ; `private/directory` de chaque fondateur une fois la grille ouverte) | `FounderDirectory` |
| Startup | `.../startups/[startupId]/layout.tsx` | `StartupContext` | `Startup`, `StartupProfile`, `StartupInternal` |
| Batch (suite) | idem batch | `EventsContext`, `ListsContext`, `CohortContext` (batchStats + scores), `LeaderboardsContext` | `PioneersEvent`, `ClosedList`, `BatchStats`, `Score`, `Leaderboard` |
| Moi | `.../(mine)/layout.tsx` (groupe de `me/` et `todo/`) | `MeGate` -> `FounderContext` (id du rattachement) + `FormsToFillContext` (formulaires qui me restent : audience `formConcernsFounder`, `formCompletions`, anonymes retenus par le navigateur ; Debrief et picks remplis restent modifiables tant qu'ils sont ouverts) ; `hooks/useTodoItems` les range (picks, hackathons, formulaires : page To do, resume en haut de SA fiche). « Me » = sa fiche `/founders/{son id}` (`founders/[founderId]/layout.tsx` monte les memes Providers via `SelfProviders` quand c'est la sienne) ; `/me` et `/me/edit` ne font que rediriger | |
| Admin | `app/(app)/admin/layout.tsx` | `AdminContext` (garde : role `staff` ; batch de travail choisi par `BatchPicker`, retenu sur le compte ; demandes de rattachement en attente, tous batchs) | `Batch`, `Founder`, `PioneersEvent`, `Form`, `ClaimRequest` |
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

- Theme sombre force, bleu `#0DB0F5` reserve a l'element actif et a l'action principale.
- Minimaliste : du texte, des filets, peu de cadres. **Pas d'icone** sauf manque de place ou chevron
  de depliage (`ScoreBreakdown` : `>` tourne vers le bas une fois ouvert), **jamais d'emoji**.
- Aucune table : des lignes empilees (`components/ui/Rows.tsx` : `LinkRow`, `ButtonRow`, `Row`),
  cibles tactiles de 60 px. Titres : `PageHeader` ; blocs : `Section` ; valeurs : `Field`
  (masque si vide).
- Dans un batch : onglets en bas sur mobile, en haut des 48em (`BatchShell`). Les onglets
  dependent du role (fondateur : To do, Me). Aucun onglet staff : TOUS les outils du staff sont dans
  `/admin` (decision du 13/11) : Access (comptes), Founder profiles, Events, Forms, Import founders, Batch settings.
- Champs de saisie en 16 px (sinon iOS zoome) : taille `md` par defaut (theme.ts). Boutons
  d'action principaux `size="md"`, pleine largeur sur mobile ; enregistrement dans `.savebar`.
- Verifier en 390 px de large : aucun debordement horizontal.
- Cibles tactiles >= 40 px : boutons en `md` par defaut (theme), lien isole (retour, email,
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
- Polices Mantine par defaut (pas d'IBM Plex Mono). Chiffres en colonnes : `className="num"` (tabular-nums).
- Rien n'est supprime : on archive (`archivedDateISOString`).
- Donnees de test : personnes fictives uniquement, emulateurs uniquement.
