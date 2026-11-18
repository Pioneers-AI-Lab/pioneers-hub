// ----------------------------
// Les signaux d'un score, dits simplement (decision du 18/11)
// ----------------------------
// Les libelles de shared/scoring.ts (`sig(...)`) portent des comptes : « Attendance (5) »,
// « Pitches (2): Team ». Un fondateur lit une phrase simple, sans compte ni ratio (la donnee
// brute `raw` reste pour le staff et les investors). Un libelle renomme dans scoring.ts se
// reporte ici ; sans correspondance (signaux importes de Spring 2026), le libelle sans ses comptes.

/** Libelle sans ses comptes -> la phrase du fondateur. */
const PLAIN_LABELS: Record<string, string> = {
  "Forms on time": "Forms answered on time",
  "Profile completeness": "Profile filled in",
  Hackathons: "Hackathon results",
  "Peer reliability": "Teammates' ratings",
  Milestones: "Program milestones",
  "Shortlisted by": "Shortlisted by other founders",
  "Peer feeling": "How teammates felt working together",
  "Existing project": "Already working on a project",
  "Existing co-founders": "Already has co-founders",
  "Background grid": "Background",
  "Founders' Background": "Founders' background",
  "Founders' Execution": "Founders' execution",
};

export function plainSignalLabel(label: string): string {
  const base = label.replace(/\s*\([^)]*\)/g, "");
  return PLAIN_LABELS[base] ?? base.replace(/^Pitches:/, "Pitch scores:");
}
