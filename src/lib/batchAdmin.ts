import { getDoc, setDoc } from "firebase/firestore";
import type { Batch, BatchSettings, BatchStatus, Program } from "@shared/types";
import { BATCH_MILESTONE_KEYS } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { createDocWithId, patchDoc } from "@/lib/firestore/write";

// ----------------------------
// Programmes et batchs (staff)
// ----------------------------
// Les ids sont des slugs lisibles (`accelerator`, `fall-2026`) : ils
// apparaissent dans les URL et dans les ids deterministes.

export const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const MILESTONE_LABELS: Record<(typeof BATCH_MILESTONE_KEYS)[number], string> = {
  kickoff: "Kick-off",
  selection_day: "Selection Day",
  pre_ic: "Pre-IC",
  ic: "Investment Committee",
  demo_day: "Demo Day",
};

export async function createProgram(input: { id: string; name: string; description: string | null }) {
  const ref = refs.program(input.id);
  if ((await getDoc(ref)).exists()) throw new Error(`A program with the id "${input.id}" already exists.`);
  await createDocWithId<Program>(ref, { name: input.name, description: input.description, archivedDateISOString: null });
}

export async function createBatch(input: {
  id: string;
  programId: string;
  name: string;
  startDayString: string;
  endDayString: string | null;
}) {
  const ref = refs.batch(input.id);
  if ((await getDoc(ref)).exists()) throw new Error(`A batch with the id "${input.id}" already exists.`);
  await createDocWithId<Batch>(ref, {
    programId: input.programId,
    name: input.name,
    startDayString: input.startDayString,
    endDayString: input.endDayString,
    status: "upcoming",
    milestones: BATCH_MILESTONE_KEYS.map((key) => ({
      key,
      label: MILESTONE_LABELS[key],
      dayString: key === "kickoff" ? input.startDayString : null,
    })),
    settings: { leaderboardVisibility: "visible", slackChannelId: null, slackTeamId: null },
    archivedDateISOString: null,
  });
}

export async function updateBatch(
  batchId: string,
  patch: { status?: BatchStatus; settings?: BatchSettings; milestones?: Batch["milestones"]; endDayString?: string | null },
) {
  await patchDoc<Batch>(refs.batch(batchId), patch);
}

/** Ajoute a une liste fermee les valeurs qu'elle n'a pas encore (import). */
export async function addListValues(key: "hardSkills" | "industries" | "positionFit", values: string[]) {
  const ref = refs.list(key);
  const current = (await getDoc(ref)).data();
  const known = new Set((current?.items ?? []).map((i) => i.value.toLowerCase()));
  const fresh = [...new Set(values.map((v) => v.trim()).filter(Boolean))].filter((v) => !known.has(v.toLowerCase()));
  if (fresh.length === 0) return 0;
  await setDoc(
    ref,
    {
      key,
      label: current?.label ?? key,
      items: [...(current?.items ?? []), ...fresh.map((v) => ({ value: v, label: v, group: null, archived: false }))],
      updatedDateISOString: new Date().toISOString(),
    },
    { merge: true },
  );
  return fresh.length;
}
