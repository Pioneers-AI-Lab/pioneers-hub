import type { Archivable, BatchScoped, DateISOString, DayString, Timestamps } from "./common";
import type { CommitmentStatus } from "./form";
import type { BackgroundCriterion } from "../background";
import { splitTextList } from "../text";

// ----------------------------
// Fondateur : quatre documents, quatre publics (SPECS §6.2)
// ----------------------------
//   founders/{founderId}                     Founder           public (tous, decision du 17/11)
//   founders/{founderId}/private/directory   FounderDirectory  fondateurs du batch + staff + investors
//   founders/{founderId}/private/profile     FounderProfile    le fondateur lui-meme + staff + investors IC
//   founders/{founderId}/private/internal    FounderInternal   staff + investors IC
//   founderWeeks/{founderId}_{weekStart}     FounderWeek       le fondateur lui-meme + staff + investors IC
//
// Brouillon du 11/11 : les donnees « simples » (listes) sont separees du
// « tracking » (ce qui se suit dans le temps). Le tracking n'est PAS un objet
// dans la fiche : un document Firestore est limite a 1 Mo et ses regles
// valent pour tout son contenu. Il vit donc dans des documents par periode
// (`founderWeeks`, `events/*/attendance`), resumes par Cloud Functions dans
// `founderStats`.
//
// L'identite (nom, email, telephone) vit dans `people/{personId}` ; les champs
// marques « copie » ci-dessous en sont recopies par Cloud Functions.
//
// Firestore ne filtre pas les champs d'un document : une regle autorise ou
// refuse le document ENTIER. La visibilite se decide donc au moment de choisir
// le document ou range un champ, pas dans l'interface. Deplacer un champ plus
// tard est une migration.
//
// ANNUAIRE = LOGIQUE DU PROFILE BOOK 2025 (decision du 11/11) : ce que le
// Profile Book montrait reste visible des fondateurs du batch, y compris genre,
// nationalite, email et WhatsApp. Seul ce qu'il ne contenait pas est masque
// (age et date de naissance, presence, scores, avis des pairs, notes).
// Le document racine reste minimal car il est public (decision du 17/11 : plus
// de consentement, toutes les fiches le sont).
//
// `@source` donne la colonne d'origine de l'Airtable Spring 2026 (table
// « Founders (attendance) », SPECS annexe B) : c'est le mapping de l'import CSV.

/** @source SP26 « Profile Category » (genere a l'import, valide par l'admin). */
export const PROFILE_CATEGORIES = ["technical", "business", "hybrid"] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];
export const PROFILE_CATEGORY_LABELS: Record<ProfileCategory, string> = { technical: "Tech", business: "Business", hybrid: "Hybrid" };

/**
 * @source SP26 « Status ». Les valeurs exactes de la colonne Airtable sont a
 * confirmer a l'import ; `left` exclut le fondateur des tirages suivants tout
 * en gardant son historique.
 */
export type FounderStatus = "enrolled" | "active" | "left" | "alumni";

/** @source 2025 (Lucie) : `left early`, `left after Selection Day`. */
export type LeftProgramReason = "left_early" | "left_after_selection_day";

/** @source SP26 « Do you have existing co-founders in the batch ? » */
export const EXISTING_CO_FOUNDERS = ["in_batch", "outside_batch", "none"] as const;
export type ExistingCoFounders = (typeof EXISTING_CO_FOUNDERS)[number];
export const EXISTING_CO_FOUNDERS_LABELS: Record<ExistingCoFounders, string> = {
  in_batch: "In the batch",
  outside_batch: "Outside the batch",
  none: "None",
};

/** Statistiques publiques, ecrites par Cloud Functions. */
export type FounderPublicStats = {
  hackathons: number;
  /** Meilleur rang d'equipe en hackathon (1 = premier). */
  bestRank: number | null;
  awards: FounderAward[];
};

/** Badges (dashboard SP26, SPECS §5.4). */
export type FounderAward = "vibethon_winner" | "best_execution" | "top_overall_pitcher" | "most_revenue_in_a_week";

// ---- founders/{founderId} ----------------------------------------------------

export type Founder = BatchScoped &
  Timestamps &
  Archivable & {
    /** Identite de la personne (`people/{personId}`), creee a l'import. */
    personId: string;
    /** Compte rattache. `null` tant que le profil n'est pas reclame. */
    uid: string | null;
    claimedDateISOString: DateISOString | null;
    /** Copie de `people.displayName`. @source SP26 « Full Name » */
    name: string;
    /** Copie de `people.photoUrl`. @source SP26 « Your photo » */
    photoUrl: string | null;
    /**
     * Grande photo (couverture des cartes de l'annuaire) : URL Storage a jeton
     * (`founders/{id}/cover.jpg`), lisible par qui lit ce document. Ecrite par
     * l'import, ce n'est pas une copie de `people` ; effacee quand
     * `people.photoUrl` change (services/fields.ts). Absent des documents plus
     * anciens ; a defaut, la carte montre `photoUrl`. @source FA26 « Your Photo »
     */
    coverPhotoUrl?: string | null;
    profileCategory: ProfileCategory | null;
    /** @source SP26 « Hard Skills » (liste fermee `lists/hardSkills`) */
    hardSkills: string[];
    /** @source SP26 « Industries » (liste fermee `lists/industries`) */
    industries: string[];
    /** @source SP26 « Roles I could take » */
    rolesICouldTake: string[];
    /** @source SP26 « Track Record One liner » (genere) */
    trackRecordOneLiner: string | null;
    /** Startup actuelle, une fois l'equipe formee. */
    startupId: string | null;
    status: FounderStatus;
    leftProgramReason: LeftProgramReason | null;
    /** Cofondateur exterieur au batch (fiche « External Founder » du SP26). */
    isExternalFounder: boolean;
    stats: FounderPublicStats | null;
  };

// ---- founders/{founderId}/private/directory ----------------------------------

/** Champs du Profile Book : visibles des fondateurs du batch, du staff et des investors. */
export type FounderDirectory = {
  /** Copie de `people.email`. */
  email: string;
  /** Copie de `people.whatsapp`. */
  whatsapp: string | null;
  /** Copie de `people.linkedinUrl`. */
  linkedinUrl: string | null;
  /**
   * Copie de `people.phone` (decision du 11/11 : coordonnees visibles du
   * batch, comme l'email et WhatsApp). Absent des documents plus anciens.
   */
  phone?: string | null;
  /** Copie de `people.slackUserId` (lien direct vers un message Slack). Absent des documents plus anciens. */
  slackUserId?: string | null;
  /** @source SP26 « Gender » */
  gender: string | null;
  /** @source SP26 « Nationality » */
  nationality: string | null;
  /** @source SP26 « Country » */
  country: string | null;
  /** @source SP26 « Introduce yourself » */
  introduceYourself: string | null;
  /**
   * @source SP26 « Main education » : une entree par ecole ou diplome (decision
   * du 15/11). Un document pas encore migre (scripts/migrate-education-tags.mjs)
   * a encore un texte : `readDirectory` (ci-dessous) le decoupe a la lecture,
   * dans l'app (convertisseur de `refs.founderDirectory`, lib/firestore/refs.ts)
   * et l'API (services/read.ts, services/fields.ts).
   */
  education: string[];
  /** @source SP26 « Degree » */
  degree: string | null;
  /** @source SP26 « Field of study » */
  fieldOfStudy: string | null;
  /** @source SP26 « Years of XP » */
  yearsOfXP: number | null;
  /** @source SP26 « Notable companies worked at » */
  notableCompanies: string[];
  /** @source SP26 « Track record » (dans les mots du fondateur) */
  trackRecord: string | null;
  /** @source SP26 « Track Record 3 liners » (genere) */
  trackRecord3Liners: string[];
  /** @source Onboarding 2026 « What I am interested in working on: » */
  interestedInWorkingOn: string | null;
  /** @source SP26 « Do you have an existing project/idea ? » */
  hasExistingProject: boolean | null;
  /** @source SP26 « If yes, explain it in a few words » */
  projectExplanation: string | null;
  hasExistingCoFounders: ExistingCoFounders | null;
  /** @source SP26 « Are you open to join another project during the program? » */
  openToJoinAnotherProject: boolean | null;
  /** @source SP26 onboarding « main startup in 2025 » */
  mainStartup2025: string | null;
  /** A deja fonde ou cofonde une entreprise avant son projet actuel (`null` : non renseigne). Absent des documents plus anciens. */
  repeatFounder?: boolean | null;
  /** @source FA26 onboarding : cherche un cofondateur. */
  lookingForCoFounder: boolean | null;
  /** @source FA26 onboarding : quel type de cofondateur. */
  coFounderTypeWanted: string | null;
  /** @source FA26 onboarding : competences recherchees chez un cofondateur. */
  coFounderSkillsWanted: string[];
  /** @source FA26 onboarding : secteurs ou il veut acquerir de l'experience. */
  industriesToExplore: string[];
  /**
   * @source FA26 onboarding « Anything else worth mentioning », avec la
   * disponibilite (temps partiel) et les noms des cofondateurs donnes au meme
   * formulaire. Facultatif. Absent des documents plus anciens.
   */
  anythingElse?: string | null;
};

/**
 * Un `private/directory` tel qu'on le lit : Education toujours en liste, meme sur
 * un document pas encore migre (ancien texte decoupe par `splitTextList`).
 * Seule lecture de l'annuaire, cote app comme cote API.
 */
export const readDirectory = <T extends object>(doc: T): T => ({
  ...doc,
  education: splitTextList((doc as { education?: unknown }).education),
});

// ---- founders/{founderId}/private/profile ------------------------------------

/** Ce que le Profile Book ne montrait pas : le fondateur lui-meme, le staff, les investors IC. */
export type FounderProfile = {
  /** @source SP26 « Age » (garde tel quel a l'import ; sinon calcule depuis la date de naissance) */
  age: number | null;
  /** @source SP26 « Birth Date » */
  birthDayString: DayString | null;
  /** @source SP26 onboarding, logistique : besoin d'aide pour le logement. */
  housingSupport: boolean | null;
  /** @source 2025 / SP26 onboarding « T-Shirt Size » */
  tShirtSize: string | null;
  /** @source SP26 onboarding : confirmation d'inscription au batch. */
  enrolmentConfirmed: boolean | null;
};

// ---- founders/{founderId}/private/internal -----------------------------------

/** Donnees internes : staff et investors IC. */
export type FounderInternal = {
  /**
   * ARCHIVE (17/11) : ni lu par un score, ni affiche, ni rendu par l'API ; la grille Background le
   * remplace. @source SP26 « Elo Score ». Classement Elo du parcours : un modele classait les profils
   * par groupes de 5, mis a jour par la methode Elo (depart 1 000) ; le detail est dans `eloMatches`
   * (archive aussi). Le Hub ne l'ecrit plus (l'import SP26, le seed et import-fa26.mjs, jamais relance, le posent encore).
   */
  eloScore?: number | null;
  eloMatchesCount?: number;
  /**
   * La grille Background du staff (lot 2, docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §3.1) :
   * le sous-score Background et le Team de sa startup. Absent ou `null` : pas encore
   * note, le sous-score est retire.
   */
  background?: FounderBackground | null;
};

/** Les champs archives de `private/internal` (l'Elo, 17/11) : gardes en base, jamais rendus. */
const ARCHIVED_INTERNAL_KEYS: ReadonlySet<string> = new Set(["eloScore", "eloMatchesCount"]);

/** Un `private/internal` tel qu'on le rend (API) : sans l'Elo archive. */
export const readFounderInternal = <T extends object>(doc: T): T =>
  Object.fromEntries(Object.entries(doc).filter(([key]) => !ARCHIVED_INTERNAL_KEYS.has(key))) as T;

/**
 * Une note Background : chaque critere de 0 a 5 (points de `BACKGROUND_CRITERIA` : 40 / 25 /
 * 20 / 15), et l'Outstanding mention du staff (+20, seulement a 100). Un critere
 * absent est retire (`shared/background.ts#ratedBackgroundScore`) ; `scores` absent :
 * pas encore note (seule une proposition existe).
 */
export type FounderBackground = {
  scores?: Partial<Record<BackgroundCriterion, number | null>>;
  outstanding?: boolean;
  /**
   * Le membre du staff qui a enregistre la note, et quand (Admin > Background). Absents
   * tant que `scores` est vide (seule une proposition existe).
   */
  ratedByUid?: string | null;
  ratedDateISOString?: DateISOString | null;
  /**
   * La note PROPOSEE par Claude (scripts/background-draft.mjs), jamais comptee : elle
   * pre-remplit la grille d'Admin > Background, le staff la valide ou la corrige (`scores`).
   */
  proposed?: FounderBackgroundProposal | null;
};

/** Une proposition de note Background (ecrite par le script) : les quatre criteres, l'Outstanding et le raisonnement. */
export type FounderBackgroundProposal = {
  scores: Record<BackgroundCriterion, number>;
  outstanding: boolean;
  ratedDateISOString: DateISOString;
  reasoning: string | null;
};

// ----------------------------
// founderWeeks/{founderId}_{weekStartDayString}  (le fondateur + staff + investors IC)
// ----------------------------
// Le suivi hebdomadaire d'un fondateur, rempli par les formulaires de
// motivation et d'objectifs (SP26 « Motivation form », « Goal form »). Les
// choix de fondateurs (interet, « je travaille avec ») sont prives : seul
// l'agregat de `founderStats` sert aux autres.

export type FounderWeek = BatchScoped & {
  founderId: string;
  /** Lundi de la semaine. */
  weekStartDayString: DayString;
  /** Semaine du programme (`Week 0` ... `Week 15 - Post IC`). */
  programWeek: string | null;
  /** @source SP26 Motivation « 3 Learnings » */
  learnings: string | null;
  /** @source SP26 Motivation « Interested in Founders » */
  interestedInFounderIds: string[];
  /** @source SP26 Motivation « Goal for the week » */
  goalForWeek: string | null;
  /** @source SP26 Goal « Status » */
  commitmentStatus: CommitmentStatus | null;
  /** @source SP26 Goal « Project Name » */
  projectName: string | null;
  /** @source SP26 Goal « Working with » */
  workingWithFounderIds: string[];
  /** @source SP26 Goal « Priority for the week » */
  priorityForWeek: string | null;
  /** @source SP26 Goal « How do you feel for this second week? » */
  feelingForWeek: string | null;
  /** @source SP26 Goal « Anything specific to mention » */
  anythingSpecific: string | null;
  // ---- Weekly update founder (lot 4, docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §2.8) : absents des semaines d'avant ----
  /** « What did you achieve? », face a l'objectif de la semaine precedente (`goalForWeek` de la semaine d'avant). */
  achieved?: string | null;
  /** Problem validation : messages envoyes dans la semaine. */
  messagesSent?: number | null;
  /** Problem validation : conversations avec des utilisateurs potentiels dans la semaine. */
  conversationsDone?: number | null;
  /** Cofounder matching : ou en est-il. */
  matchResult?: MatchResult | null;
  updatedDateISOString: DateISOString;
};

/** « Cofounder matching: result » du Weekly update founder (§2.8). */
export const MATCH_RESULTS = ["match", "no_match", "still_looking"] as const;
export type MatchResult = (typeof MATCH_RESULTS)[number];
export const MATCH_RESULT_LABELS: Record<MatchResult, string> = { match: "Match", no_match: "No match", still_looking: "Still looking" };

// ----------------------------
// founderStats/{founderId}  (agregat staff + investors IC, recalcule par Cloud Functions)
// ----------------------------
// Signaux calcules a partir des presences, de `founderWeeks` et des equipes.
// Les sous-scores sont dans `scores/` (lisibles aussi par les investors
// portfolio) ; ici les donnees brutes, dont les avis des pairs agreges.

export type FounderStats = BatchScoped & {
  attendance: {
    attended: number;
    total: number;
    /** 0-1. Present, Late ou In office comptent comme presents. */
    rate: number | null;
  };
  /** Interet recu, donne et mutuel (`founderWeeks`). Ids de fondateurs. */
  interestIncoming: string[];
  interestOutgoing: string[];
  interestMutual: string[];
  /** Meme chose pour « working with » (goal form). */
  workingWithIncoming: string[];
  workingWithOutgoing: string[];
  workingWithMutual: string[];
  /** Nombre de coequipiers differents sur l'ensemble des exercices. */
  uniqueTeammates: number;
  /** Moyennes des peer ratings recus (1-5) : ressenti et fiabilite. Agregat uniquement. */
  peerRating: { likability: { average: number | null; count: number }; reliability: { average: number | null; count: number } };
  computedDateISOString: DateISOString;
};

// ----------------------------
// picks/{eventId}_{founderId}  (staff + l'auteur)
// ----------------------------
// Des choix prives et classes, toujours rattaches a un evenement qui les
// demande (`PioneersEvent.picks`) : les mutual picks avant le hackathon de
// 3 jours (« avec qui monter une boite ? »), le « qui t'a marque » d'un speed
// dating. Les choix reciproques sont apparies en premier par le staff.

/** Un fondateur qu'on peut choisir dans ce batch : ni parti, ni archive. */
export const isPickable = (f: Pick<Founder, "batchId" | "status" | "archivedDateISOString">, batchId: string): boolean =>
  f.batchId === batchId && f.status !== "left" && f.archivedDateISOString === null;

/**
 * Un fondateur qui suit le programme du batch : choisissable, et pas un
 * cofondateur exterieur au batch. Les `alumni` en sont (un batch termine garde
 * ses fondateurs) : c'est a eux que s'adressent formulaires et relances.
 */
export const isBatchParticipant = (
  f: Pick<Founder, "batchId" | "status" | "archivedDateISOString" | "isExternalFounder">,
  batchId: string,
): boolean => isPickable(f, batchId) && !f.isExternalFounder;

export type Picks = BatchScoped & {
  eventId: string;
  founderId: string;
  /** Classes : le premier est le premier choix. */
  pickedFounderIds: string[];
  submittedDateISOString: DateISOString;
};
