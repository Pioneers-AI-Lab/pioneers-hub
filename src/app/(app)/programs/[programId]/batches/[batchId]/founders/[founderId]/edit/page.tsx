"use client";

import { useBatch } from "@/context/BatchContext";
import { useFounder } from "@/context/FounderContext";
import { useProgram } from "@/context/ProgramContext";
import { paths } from "@/lib/paths";
import { BlockedState } from "@/components/ui/BlockedState";
import { ProfileEditor } from "@/components/founder/ProfileEditor";

/** Edition d'un profil depuis sa fiche : le staff, ou le fondateur lui-meme. */
export default function EditFounderPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founder, canEdit } = useFounder();
  const founderHref = paths.founder(program.id, batch.id, founder.id);

  if (!canEdit) return <BlockedState reason="forbidden" backHref={founderHref} />;
  return <ProfileEditor back={{ href: founderHref, label: founder.name }} />;
}
