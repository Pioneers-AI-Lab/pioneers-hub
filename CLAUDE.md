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
reimport sans perte des rattachements). Photos et logos : vignettes JPEG 128 px en `data:` URL dans
`photoUrl` / `logoUrl`, faute de Storage (plan Blaze) ; a migrer vers Storage ensuite.

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
  chaque requete. **v1 : staff seulement** (l'Admin SDK ignore les regles ; ouvrir aux investors = filtrer
  par `shared/access.ts`).
- **Confirmation MCP** : un outil d'ecriture sans `planId` stocke un `writePlans` et rend l'apercu ; avec
  `planId` seul, il recalcule, refuse si l'apercu a change (`plan_stale`), ecrit. /v1 : `?dryRun=true` et
  `Idempotency-Key` (verifiee dans la transaction).
- **Ecritures de champs** : `set_fields` lit le registre (`shared/fieldRegistry.ts`) : validation, listes
  fermees (cle ou libelle), `fill_empty` / `overwrite` / `merge_unique`, aucune valeur vide, copies
  `people` -> fondateurs. Les documents de suivi (semaine, update, presence, soumission) se creent a la demande.
- **Jamais lus par l'API** : `peerRatings`, `picks`, `judges`, `apiKeys`, `writePlans` (SPECS §4.8).
- **OAuth 2.1** (`functions/src/oauth`, connecteur claude.ai et Claude Code) : decouverte RFC 9728 / 8414, enregistrement
  dynamique, `/oauth/authorize` -> page front `/oauth/consent` (callables `oauthDescribeRequest` / `oauthDecide`),
  `/oauth/token` avec PKCE S256. Acces 1 h, rafraichissement 30 j a rotation ; un code ou un rafraichissement rejoue
  revoque l'autorisation. Secrets stockes par empreinte. Qui peut accepter : `canUseApi` (shared/access.ts), la regle
  de l'API. Hosting a une reecriture explicite `/.well-known/**` (l'emulateur ne passe pas les chemins a point par `**`).
- Adresse a donner a Claude : `https://pioneers-hub-api.web.app/mcp`.
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
- `shared/presets/eventTemplates.ts` : modeles d'evenements (grille, metriques). Le type d'un evenement
  est sa MECANIQUE (`team_challenge`, `pitch`, `matching`, `session`, `meeting`), pas son nom.
- `shared/fieldRegistry.ts` : registre des champs ecrivables par formulaire, import ou MCP (`dbField`).

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
| `founders/{id}/private/internal`, `founderStats`, `notes`, `assessments`, `eloMatches` | staff + investors IC |
| `startups/{id}` | public |
| `startups/{id}/private/profile`, `kpiSeries` | membres + staff + investors |
| `startups/{id}/private/internal` | staff + investors IC |
| `scores/*` (sous-scores, ponderes a l'affichage) | staff + investors (IC et portfolio) |
| `events/*/peerRatings`, `events/*/judges`, `apiKeys`, `auditLogs` | staff |

Rattachement d'un compte (SPECS §3.1, `lib/accounts.ts`) : a la connexion, l'accueil (`app/(app)/page.tsx`)
essaie l'email VERIFIE du compte contre `people.email` / `altEmails` et rattache en un lot
(fondateur, `batchMemberships`, personne, compte) ; les regles verifient le lot. Sinon `/claim`
(« comme Tricount », decision du 11/11) : le compte choisit son batch puis un profil non reclame,
et il est rattache tout de suite (`claimProfile`). Email verifie obligatoire, un profil par batch.
Le staff voit chaque rattachement dans Staff > Access et peut delier. `claimRequests` (validation
par le staff) reste pour les cas a trancher.
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
| Startup | `.../startups/[startupId]/layout.tsx` | `StartupContext` | `Startup`, `StartupProfile`, `StartupInternal` |
| Batch (suite) | idem batch | `EventsContext`, `ListsContext`, `CohortContext` (batchStats + scores), `LeaderboardsContext` | `PioneersEvent`, `ClosedList`, `BatchStats`, `Score`, `Leaderboard` |
| Moi | `.../me/layout.tsx`, `.../todo/layout.tsx` | `MeGate` -> `FounderContext` (id du rattachement) + `OpenFormsContext` | |
| Staff | `.../staff/layout.tsx` | `StaffContext` (garde : role `staff`) | `User`, `ClaimRequest` |
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
5. **Ecouteurs via `useDocListener` / `useQueryListener`** : `undefined` = on attend une
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
- Minimaliste : du texte, des filets, peu de cadres. **Pas d'icone** sauf manque de place,
  **jamais d'emoji**.
- Aucune table : des lignes empilees (`components/ui/Rows.tsx` : `LinkRow`, `ButtonRow`, `Row`),
  cibles tactiles de 60 px. Titres : `PageHeader` ; blocs : `Section` ; valeurs : `Field`
  (masque si vide).
- Dans un batch : onglets en bas sur mobile, en haut des 48em (`BatchShell`). Les onglets
  dependent du role (fondateur : To do, Me ; staff : Staff).
- Champs de saisie en 16 px (sinon iOS zoome) : taille `md` par defaut (theme.ts). Boutons
  d'action principaux `size="md"`, pleine largeur sur mobile ; enregistrement dans `.savebar`.
- Verifier en 390 px de large : aucun debordement horizontal.
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
