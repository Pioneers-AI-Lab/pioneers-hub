"use client";

import { Alert, Button, Group, Text } from "@mantine/core";
import { useBatch } from "@/context/BatchContext";
import { useFounder } from "@/context/FounderContext";
import { useFounderDirectories } from "@/context/FounderDirectoriesContext";
import { useProgram } from "@/context/ProgramContext";
import { useAction } from "@/hooks/useAction";
import { setFounderArchived } from "@/lib/accounts";
import { formatDay } from "@/lib/format";
import { paths } from "@/lib/paths";
import { FounderCard } from "@/components/founder/FounderCard";
import { MeTodo } from "@/components/founder/MeTodo";
import { BackButton } from "@/components/ui/PageHeader";

/** La fiche d'un fondateur. Sur la sienne (« Me »), il voit en plus To do. */
export default function FounderPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founder } = useFounder();
  // Retour sur la vue quittee : vue, filtres et recherche (query gardee par le layout).
  const { query } = useFounderDirectories();
  return (
    <>
      <BackButton href={paths.founders(program.id, batch.id, query)} label="All founders" mb="md" />
      {founder.archivedDateISOString !== null && <ArchivedNotice />}
      <FounderCard selfSections={<MeTodo />} />
    </>
  );
}

/** Profil archive : seul le staff arrive ici (FounderContext), il peut le restaurer. */
function ArchivedNotice() {
  const { founder } = useFounder();
  const { busy, run } = useAction();
  return (
    <Alert color="gray" variant="light" mb="md" p="sm">
      <Group gap="sm" wrap="nowrap" justify="space-between">
        <Text size="sm" style={{ minWidth: 0 }}>
          <Text span fw={600} inherit>
            Archived
          </Text>{" "}
          on {formatDay(founder.archivedDateISOString?.slice(0, 10))}. Hidden from the lists, draws and forms; only the staff can
          open this page.
        </Text>
        <Button
          size="md"
          variant="default"
          style={{ flexShrink: 0 }}
          loading={busy !== null}
          onClick={() => run(() => setFounderArchived(founder.id, false), "Profile restored.")}
        >
          Restore
        </Button>
      </Group>
    </Alert>
  );
}
