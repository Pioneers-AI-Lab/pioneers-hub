"use client";

import Link from "next/link";
import { Button, Group } from "@mantine/core";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { paths } from "@/lib/paths";
import { FounderCard } from "@/components/founder/FounderCard";

export default function MePage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  return (
    <>
      <Group justify="flex-end" mb="sm">
        <Button component={Link} href={paths.meEdit(program.id, batch.id)} variant="default">
          Edit profile
        </Button>
      </Group>
      <FounderCard />
    </>
  );
}
