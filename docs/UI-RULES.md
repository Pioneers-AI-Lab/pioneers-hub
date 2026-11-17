# Règles d'interface du Founder Hub

Règles fixées le 17/11 après un audit UI complet (écarts, proximité, couleur, uniformité,
interactions). À lire avant toute modification d'écran. Elles complètent la section
« Interface » de `CLAUDE.md` (mobile d'abord, thème sombre, pas d'icône, lignes empilées).

Chaque règle a un **endroit unique** dans le code : on y touche, pas ailleurs. Une
exception se justifie en commentaire, à côté du code.

## 1. Espacement : une échelle, quatre usages

Échelle du thème (`src/theme.ts`, multiples de 4) :

| Jeton | px | Usage |
|---|---|---|
| `xs` | 8 | en-tête d'une section → son contenu ; libellé → valeur ; tags entre eux |
| `sm` | 12 | **entre blocs frères** : cartes, tuiles, graphiques, champs d'un formulaire court |
| `md` | 16 | rembourrage intérieur d'une carte ; champs d'une fiche |
| `lg` | 24 | entre groupes dans une même section |
| `xl` | 32 | entre sections (`.section`, avec un filet) |

- **Un seul écart entre cartes sœurs : 12 px (`sm`)**, quel que soit le conteneur :
  `Section` (pile), `StatGrid`, grille de l'annuaire. Ne jamais poser `spacing="md"` sur une
  grille de cartes ni `gap="xs"` sur une pile de cartes.
- `Section` (`components/ui/Section.tsx`) porte la règle : 4 px titre → aide, 8 px en-tête →
  contenu, 12 px entre ses enfants. On ne remet pas de `mt` / `mb` sur un enfant direct
  (l'écart doublerait).
- Dans `globals.css`, les espacements passent par `var(--mantine-spacing-*)` : l'échelle n'a
  qu'une source, le thème.
- Valeurs en dur : seulement 2 ou 4 px, pour serrer deux lignes de texte d'un même bloc
  (titre et sous-titre). Rien d'autre hors échelle (pas de 6, 10, 14).
- **Proximité** : l'espace à l'intérieur d'un groupe est toujours plus petit que l'espace
  entre groupes. Un texte d'aide se place sous le titre (`hint`), jamais au milieu des cartes.

## 2. Alignement

- Le texte d'une ligne (`.row`) commence au même x que le titre de sa section. Le fond du
  survol déborde de 8 px de chaque côté (`.row::after`), pas le texte.
- Une page qui déborde de la colonne (grille de l'annuaire, `.bleed-wide`) déborde
  **entière** : filtres et recherche compris. Pas de bord gauche qui saute en cours de page.
- Graphique en barres : le libellé touche sa barre (libellé aligné à droite, barre, valeur).
- Un nom et son nombre ne se séparent jamais à la ligne (`white-space: nowrap` sur la paire).

## 3. Surfaces

- **Une carte = `.card`** (`globals.css`) : fond `dark.6`, filet `dark.4`, rayon `md` ; avec
  `.card-pad` pour le rembourrage `md` (toutes sauf la carte de l'annuaire, dont la photo va
  bord à bord). Tuiles (`StatTile`), graphiques (`ChartCard`), prochaine séance, annuaire :
  la même classe. Pas de `Paper` ni d'autre fond de carte.
- Carte cliquable = `.card card-link state-layer` (`CardLink` dans `StatTile.tsx`,
  `FounderGridCard`). Une tuile cliquable et une tuile fixe ont la **même structure** :
  libellé et chiffre au même endroit.
- `overflow: hidden` seulement sur une carte à photo de couverture (sinon les infobulles
  des graphiques sont coupées).
- Avatar : toujours rond (`radius="xl"` jusqu'à 64 px, `"100%"` au-delà).

## 4. Couleur : chaque teinte a un sens

| Couleur | Sens, et seulement celui-là |
|---|---|
| Bleu vif `pioneers.6` | action principale, élément actif (onglet), anneau de focus, « Now » |
| Bleu clair `pioneers.3` | titres de section (`SectionTitle`) et astérisque obligatoire |
| Bleu lien `pioneers.4` **souligné** | lien de texte |
| Gris `dark.2` | sur-titres `.label`, textes secondaires |
| Orange | alerte (profil incomplet), aperçu « View as » |
| Rouge | erreur, action destructive |

- **Un lien de texte est souligné** (`Anchor` souligné par défaut dans le thème,
  `ExternalLink` aussi). Le bleu seul ne le distingue pas d'un titre (WCAG 1.4.1). Seul le
  fil d'Ariane se souligne au survol seulement.
- **`.label` (sur-titre en capitales) : un seul style partout**, gris, Plex Mono 12 px. Pas
  de variante bleue dans les cartes.
- Graphiques : `CHART_COLORS` (`components/charts/ChartCard.tsx`), la marque d'abord.

## 5. Tags

- **Une couleur par champ, jamais par valeur** (`TAG_KIND_COLOR`, `components/ui/Tags.tsx`) :
  compétences indigo, industries teal, rôles grape, écoles yellow, entreprises pink.
  Chaque tag a une couleur ; la couleur dit à quel champ il appartient.
- Interdits pour un tag : le bleu de la marque (action), le rouge (erreur), l'orange
  (alerte), le gris (se lit « désactivé »).
- Un nouveau champ en tags = une nouvelle entrée dans `TAG_KIND_COLOR`, une teinte distincte.
  `Tags` / `tagsOrNull` exigent le `kind`.

## 6. Interactions : mêmes états partout

Tout élément cliquable a les mêmes quatre états, définis **une fois** dans `globals.css` :

| État | Rendu |
|---|---|
| Survol (`@media (hover: hover)` seulement) | voile blanc 5 % (`--state-hover`) |
| Appui | voile blanc 10 % (`--state-pressed`) |
| Menu ouvert depuis l'élément (`data-expanded`) | voile d'appui maintenu |
| Focus clavier | anneau bleu `pioneers.6` 2 px ; à l'intérieur (`-2px`) pour une ligne, une carte, un onglet |

- **Un élément cliquable fait maison porte la classe `state-layer`** dans son balisage :
  lignes de `Rows.tsx`, cartes-liens, onglets de `BatchShell`, avatar du compte, logo, lignes
  du menu du compte. Le CSS a UNE règle par état ; seuls des modificateurs s'y ajoutent
  (voile débordant d'une `.row`, coins d'un onglet, bordure d'une carte au survol). Sans la
  classe, l'élément est muet au survol et au clic. Un élément arrondi donne son
  `border-radius` (le voile en hérite).
- Les composants Mantine (Button, ActionIcon, SegmentedControl, Menu) ont leurs états ; on
  ne les refait pas.
- Rien ne dépend du survol (CLAUDE.md) : le voile n'est qu'un retour visuel.

## 7. Repérage

- Toute page d'un batch a un onglet actif. Une page sans onglet propre garde celui d'où l'on
  y va (`also` dans `BatchShell`) : un événement est sous **Calendar**, le leaderboard sous
  **Home**.
- Onglet actif : texte bleu vif, en haut (ordinateur) comme en bas (mobile).
- Bouton retour (`PageHeader back`) : il mène à la page de l'onglet actif et **porte son nom**
  (« Calendar », « All founders », « Home »), jamais un identifiant (« fa26 »).

## 8. Contenu : ne rien répéter

- Une information affichée une fois par écran : pas l'heure de début à gauche **et** dans la
  plage dessous (`formatEndPlace` : « Until 13:00 · lieu »), pas le jour deux fois dans une
  plage (`formatDateTimeRange` : « Wed 18 Nov, 09:30 to 11:30 »), pas le type sous un titre
  qui le contient déjà (« Lunch roulette »).
- Étiquette d'un événement à côté de son nom : **`shownEventLabel`**
  (`components/event/eventLabels.ts`), jamais `eventLabel` directement. Elle tait « Session »
  (presque tous les événements) et un type que le nom dit déjà.
- Mobile : la grille de l'annuaire passe à 2 colonnes et la carte se résume (photo, nom,
  profil, phrase). `.card-details` est masqué par une requête sur le conteneur de la grille
  (`@container simple-grid`, posé par `SimpleGrid type="container"`), pas un conteneur par
  carte. Les tags restent sur la fiche.

## 9. Icônes de navigation

Les icônes sont permises pour naviguer (17/11), toujours les mêmes, au même endroit :

| Icône | Sens | Où |
|---|---|---|
| `>` | mène à une autre page de l'app, ou ouvre une fenêtre / une feuille | bout de `LinkRow` (après la valeur), `ButtonRow opens`, coin haut droit de `CardLink` (tuile, prochaine séance) : `NavChevron` |
| `↗` | ouvre un autre site, nouvel onglet | bout d'`ExternalLinkRow` |
| `v` (retourné une fois ouvert) | déplie un contenu sur place | `ExpandChevron` : `ButtonRow` `expanded`, bouton « More options », menu « View as » |
| `<` | retour à la page parente | `BackButton` |

- `>` et `v` ne se confondent pas : `>` ne déplie jamais, `v` ne change jamais de page.
- Pas d'icône quand une action occupe déjà la droite (`LinkRow` avec `action`, `ActionRow`), sur
  une ligne qui agit tout de suite (archiver, marquer présent, choisir un modèle : `ButtonRow`
  sans `opens`), ni sur une carte-photo de l'annuaire (la photo dit déjà « ouvrir »).

## 10. Aides repliées

**Une explication ne s'affiche qu'au (?) à droite de son libellé** (comme Admin > Events > un
événement). Un seul mécanisme, `components/ui/Help.tsx` :

- titre de page : `PageHeader` `help` (et non `subtitle`, gardé pour un état : date, statut) ;
- titre de section : `Section` `help` (et non `hint`) ;
- libellé de champ : `<WithHelp label="..." help="..." note={...}>{(field) => <Select {...field} />}</WithHelp>`
  (sans hook à l'appel : utilisable en boucle ou sous condition). Le (?) suit le libellé ; l'aide
  dépliée va dans la `description` du champ, reliée au champ pour un lecteur d'écran, après `note`
  (ce qui reste visible). Jamais `description=` pour une explication ;
- bloc sans champ : `HelpBlock`.

Reste **visible**, sans (?) : `Section` `hint` ou `description` d'un champ, et seulement pour

- un état ou une donnée : « Published Tue 17 Nov », « 12 of 20 columns mapped », complétude, « Key: x » ;
- la raison d'un blocage : champ désactivé ou verrouillé, étape préalable manquante ;
- une contrainte qu'on enfreint sinon : « 3 at most », « At least 6 characters » ;
- un appel à l'action : « sign in to see everyone » ;
- la consigne d'un formulaire public, rédigée pour les répondants (`TypeForm`, `FormSheet` : ils
  n'utilisent pas `Help.tsx`).

Hors de cette règle (ce ne sont pas des descriptions de libellé) : le texte d'une fenêtre
(`ResponsiveDialog`), la note sous un bouton d'enregistrement, une consigne qui tient lieu
d'état vide (« Tap a day for its status »).

L'état s'affiche sous le titre, avant l'aide dépliée.

## Vérifier un changement d'écran

1. Captures en 390 px (mobile, `isMobile`) et 1 280 px, en haut de page et au défilement. Pages
   connectées : émulateurs + `npm run seed`, connexion par le faux Google de l'émulateur Auth
   (comptes `staff@pioneers.test`, `ada@pioneers.test`).
2. Mesurer les écarts au DOM si deux blocs ont l'air inégaux (`getBoundingClientRect`).
3. Survol, appui et Tab au clavier sur chaque élément cliquable touché : voile et anneau présents.
4. Aucun débordement horizontal en 390 px.

## Sources

- Proximité : NN/g, *Proximity Principle in Visual Design* — https://www.nngroup.com/articles/gestalt-proximity/
- Région commune (cartes) : J. Nielsen, *Card pattern* (Palmer, 1992) — https://www.uxtigers.com/post/card-pattern
- Cohérence : NN/g, *Consistency and Standards* — https://www.nngroup.com/articles/consistency-and-standards/
- Signaux de clic : NN/g, *Beyond Blue Links: Making Clickable Elements Recognizable* — https://www.nngroup.com/articles/clickable-elements/
- Couleur porteuse de sens : NN/g, *Using Color to Enhance Your Design* — https://www.nngroup.com/articles/color-enhance-design/
- Couleur seule interdite : WCAG 1.4.1 *Use of Color* — https://www.w3.org/TR/UNDERSTANDING-WCAG/visual-audio-contrast-without-color.html
- Focus visible : WCAG 2.4.7 — https://www.w3.org/WAI/WCAG22/Understanding/focus-visible
- États d'interaction (calques d'état) : Material Design — https://m2.material.io/go/design-states
- Vous êtes ici : NN/g, *Visibility of System Status* — https://www.nngroup.com/articles/visibility-system-status/
- Aides repliées : NN/g, *Progressive Disclosure* — https://www.nngroup.com/articles/progressive-disclosure/
