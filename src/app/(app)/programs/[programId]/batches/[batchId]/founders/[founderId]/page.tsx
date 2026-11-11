"use client";

import { Anchor } from "@mantine/core";
import Link from "next/link";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { paths } from "@/lib/paths";
import { FounderCard } from "@/components/founder/FounderCard";

export default function FounderPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  return (
    <>
      <Anchor component={Link} href={paths.founders(program.id, batch.id)} size="sm" c="dimmed" mb="md" display="inline-block">
        All founders
      </Anchor>
      <FounderCard />
    </>
  );
}
