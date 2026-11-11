import type { BatchScoped, DateISOString, TargetKind } from "./common";
import type { PitchStage } from "./event";

// ----------------------------
// assessments/{targetType}_{targetId}_{stage}  (staff + investors IC)
// ----------------------------
// Fiche d'evaluation generee par Claude (SPECS §4.5), sur le modele « SU2025
// Progress Summary », preparee pour une etape de decision (Selection Day,
// Pre-IC, IC). Lue par les investors dans leur espace, sur la fiche du
// fondateur ou de la startup.
//
// Pourquoi la stocker plutot que la regenerer a chaque lecture :
// - elle est VALIDEE par le staff avant d'etre montree (garde-fou de la spec) :
//   on ne valide pas un texte qui change a chaque affichage ;
// - c'est la trace de ce que les investors ont lu au moment de decider, alors
//   que les donnees continuent d'evoluer ;
// - une generation est lente, couteuse et jamais identique deux fois ;
// - chaque phrase garde le lien vers ses preuves.
// Les questions ponctuelles du staff a Claude (via le MCP) ne sont, elles,
// pas stockees.
//
// Garde-fous : chaque phrase renvoie vers ses preuves, une donnee absente est
// signalee (jamais inventee), et le staff valide avant toute decision.

export type AssessmentTargetType = TargetKind;

/** `draft` : genere, a relire ; `validated` : relu, visible des investors ; `superseded` : remplace par une version plus recente. */
export type AssessmentStatus = "draft" | "validated" | "superseded";

/** Lien vers une preuve : chemin du document Firestore cite. */
export type SourceRef = {
  kind:
    | "evaluation"
    | "form_response"
    | "checkin"
    | "metric_snapshot"
    | "note"
    | "peer_rating_aggregate"
    | "submission"
    | "attendance"
    | "membership";
  path: string;
};

export type AssessmentSection = {
  key: string;
  title: string;
  body: string;
  sources: SourceRef[];
};

export type Assessment = BatchScoped & {
  targetType: AssessmentTargetType;
  targetId: string;
  /** Etape de decision pour laquelle la fiche est preparee ; `null` = fiche courante, hors etape. */
  stage: PitchStage | null;
  status: AssessmentStatus;
  sections: AssessmentSection[];
  /** Ce qu'on ne sait pas encore. */
  missingData: string[];
  /** Donnees prises en compte jusqu'a cette date. */
  dataAsOfDateISOString: DateISOString;
  model: string;
  promptVersion: string;
  generatedDateISOString: DateISOString;
  /** Le staff a retouche le texte genere. */
  editedByUid: string | null;
  validatedByUid: string | null;
  validatedDateISOString: DateISOString | null;
};
