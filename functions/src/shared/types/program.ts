import type { Archivable, Timestamps } from "./common";

// ----------------------------
// programs/{programId}
// ----------------------------
// Le niveau le plus haut : Pioneers Accelerator, AI Lab... L'id est un slug
// lisible choisi a la creation (`accelerator`), pour des URL partageables.
// Public : nom et description.

export type Program = Timestamps &
  Archivable & {
    name: string;
    description: string | null;
  };
