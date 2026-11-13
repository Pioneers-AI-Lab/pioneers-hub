"use client";

import { Anchor } from "@mantine/core";
import Link from "next/link";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { paths } from "@/lib/paths";
import { FounderCard } from "@/components/founder/FounderCard";
import { MeSections } from "@/components/founder/MeSections";

/** La fiche d'un fondateur. Sur la sienne (« Me »), il voit en plus To do et Coming up. */
export default function FounderPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  return (
    <>
      <Anchor component={Link} href={paths.founders(program.id, batch.id)} size="sm" c="dimmed" mb="md" className="tap-link">
        All founders
      </Anchor>
      <FounderCard selfSections={<MeSections />} />
    </>
  );
}
