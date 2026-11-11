"use client";

import { Select } from "@mantine/core";
import { useAdmin } from "@/context/AdminContext";

const STATUS_LABEL = { upcoming: "upcoming", active: "live", completed: "completed" } as const;

/** Le batch sur lequel travaillent les outils. Retenu par navigateur. */
export function BatchPicker() {
  const { batches, batch, selectBatch, programsById } = useAdmin();
  return (
    <Select
      label="Batch"
      allowDeselect={false}
      value={batch.id}
      onChange={(id) => id && selectBatch(id)}
      data={batches.map((b) => ({
        value: b.id,
        label: `${b.name} · ${programsById.get(b.programId)?.name ?? b.programId} · ${STATUS_LABEL[b.status]}`,
      }))}
      comboboxProps={{ withinPortal: true }}
    />
  );
}
