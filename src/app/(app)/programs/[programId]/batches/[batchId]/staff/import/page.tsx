"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import { Box, Button, FileButton, Group, Progress, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import {
  applyImport,
  parseRows,
  planImport,
  type ColumnMapping,
  type ImportAction,
  type ImportResult,
  type PlannedRow,
} from "@/lib/import/founders";
import { guessTarget, targetOptions, type ImportTarget } from "@/lib/import/targets";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { Row, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { StatGrid, StatTile } from "@/components/ui/StatTile";

// ----------------------------
// Import des fondateurs (SPECS §3.2 « Import CSV »)
// ----------------------------
// 1. Fichier CSV (export du formulaire d'onboarding ou d'Airtable).
// 2. Chaque colonne va vers un champ, comme dans Brevo ; les colonnes connues
//    (SP26, onboarding) sont reconnues d'office.
// 3. Apercu : nouveaux, deja en base, doublons, erreurs de valeur.
// 4. Ecriture. Un fondateur deja dans le batch n'est que COMPLETE (champs vides).

type Csv = { fileName: string; headers: string[]; rows: Record<string, string>[] };

const ACTION_LABEL: Record<ImportAction, string> = {
  create: "New",
  add_to_batch: "Known person, new in this batch",
  fill_existing: "Already in this batch: fill empty fields",
  skip: "Skipped",
};

export default function ImportFoundersPage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founders } = useFounders();
  const [csv, setCsv] = useState<Csv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [plan, setPlan] = useState<PlannedRow[] | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [filter, setFilter] = useState<"all" | "issues">("all");
  const options = useMemo(() => targetOptions(), []);

  const readFile = (file: File | null) => {
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (parsed) => {
        const headers = (parsed.meta.fields ?? []).filter((h) => h.trim() !== "");
        // Une meme cible ne se prend qu'une fois : la premiere colonne reconnue la garde.
        const used = new Set<ImportTarget>();
        const guessed: ColumnMapping = {};
        for (const h of headers) {
          const t = guessTarget(h);
          guessed[h] = t && !used.has(t) ? t : null;
          if (t) used.add(t);
        }
        setCsv({ fileName: file.name, headers, rows: parsed.data });
        setMapping(guessed);
        setPlan(null);
        setResult(null);
      },
      error: (err) => notifications.show({ color: "red", message: `Could not read the file: ${err.message}` }),
    });
  };

  const mappedTargets = Object.values(mapping).filter(Boolean);
  const hasEmail = mappedTargets.includes("email");
  const hasName = mappedTargets.includes("fullName") || mappedTargets.includes("person.firstName");

  const preview = async () => {
    if (!csv) return;
    setIsPlanning(true);
    try {
      setPlan(await planImport(parseRows(csv.rows, mapping), founders));
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsPlanning(false);
    }
  };

  const run = async () => {
    if (!plan) return;
    setProgress({ done: 0, total: plan.filter((r) => r.action !== "skip").length });
    try {
      const res = await applyImport(plan, batch, (done, total) => setProgress({ done, total }));
      setResult(res);
      setPlan(null);
      setCsv(null);
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setProgress(null);
    }
  };

  const count = (a: ImportAction) => plan?.filter((r) => r.action === a).length ?? 0;
  const withIssues = plan?.filter((r) => r.action === "skip" || r.errors.length > 0) ?? [];
  const shown = filter === "issues" ? withIssues : (plan ?? []);
  const back = { href: paths.staff(program.id, batch.id), label: "Staff" };

  return (
    <>
      <PageHeader back={back} title="Import founders" subtitle={`Into ${batch.name}. Existing values are never overwritten.`} />

      {result && (
        <Section title="Done">
          <StatGrid>
            <StatTile label="New founders" value={result.created + result.addedToBatch} href={paths.founders(program.id, batch.id)} />
            <StatTile label="Completed" value={result.filled} />
          </StatGrid>
          <Text size="sm" c="dimmed">
            {result.skipped} skipped. {result.listValuesAdded} new values added to the skills, industries and roles lists.
            Founders can now sign in: their account links itself by email.
          </Text>
        </Section>
      )}

      <Section title="1. File">
        <Group>
          <FileButton onChange={readFile} accept=".csv,text/csv">
            {(props) => (
              <Button {...props} variant={csv ? "default" : "filled"} size="md">
                {csv ? "Choose another file" : "Choose a CSV file"}
              </Button>
            )}
          </FileButton>
          {csv && (
            <Text size="sm" c="dimmed">
              {csv.fileName} · <span className="num">{csv.rows.length}</span> rows
            </Text>
          )}
        </Group>
        {!csv && <Text size="sm" c="dimmed">Export the onboarding form or the Airtable table as CSV.</Text>}
      </Section>

      {csv && (
        <Section
          title="2. Columns"
          hint={`${mappedTargets.length} of ${csv.headers.length} columns mapped. Leave a column empty to ignore it.`}
        >
          <RowList>
            {csv.headers.map((h) => {
              const sample = csv.rows.find((r) => r[h]?.trim())?.[h] ?? "";
              return (
                <Stack key={h} gap={6} py="sm" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
                  <Box>
                    <Text fw={500} size="sm" style={{ overflowWrap: "anywhere" }}>
                      {h}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {sample || "(empty)"}
                    </Text>
                  </Box>
                  <Select
                    aria-label={`Field for ${h}`}
                    placeholder="Ignore this column"
                    data={options}
                    value={mapping[h] ?? null}
                    onChange={(v) => {
                      setMapping((m) => ({ ...m, [h]: (v as ImportTarget | null) ?? null }));
                      setPlan(null);
                    }}
                    searchable
                    clearable
                  />
                </Stack>
              );
            })}
          </RowList>
          {(!hasEmail || !hasName) && (
            <Text size="sm" c="pioneers">
              Map an email column and a name column (full name, or first name) to continue.
            </Text>
          )}
          <Button size="md" fullWidth maw={400} disabled={!hasEmail || !hasName} loading={isPlanning} onClick={preview} mt="xs">
            Preview the import
          </Button>
        </Section>
      )}

      {plan && (
        <Section title="3. Preview">
          <StatGrid>
            <StatTile label="New" value={count("create") + count("add_to_batch")} />
            <StatTile label="Already here" value={count("fill_existing")} />
          </StatGrid>
          <Text size="sm" c="dimmed">
            <span className="num">{count("skip")}</span> skipped,{" "}
            <span className="num">{plan.filter((r) => r.errors.length > 0).length}</span> with values that could not be read
            (those values are left out, the rest of the row is imported).
          </Text>
          <SegmentedControl
            value={filter}
            onChange={(v) => setFilter(v as "all" | "issues")}
            data={[
              { value: "all", label: `All (${plan.length})` },
              { value: "issues", label: `Issues (${withIssues.length})` },
            ]}
          />
          {shown.length === 0 ? (
            <Empty>No issue.</Empty>
          ) : (
            <RowList>
              {shown.slice(0, 200).map((r) => (
                <Row
                  key={r.line}
                  title={[r.firstName, r.lastName].filter(Boolean).join(" ") || `Line ${r.line}`}
                  subtitle={
                    <>
                      {r.email ?? "No email"}
                      {r.errors.length > 0 && (
                        <Text span size="xs" c="red.4" display="block" style={{ whiteSpace: "normal" }}>
                          {r.errors.join(" · ")}
                        </Text>
                      )}
                    </>
                  }
                  meta={
                    <Text size="xs" c={r.action === "skip" ? "red.4" : "dimmed"} maw={130} style={{ whiteSpace: "normal" }}>
                      {r.skipReason ?? ACTION_LABEL[r.action]}
                    </Text>
                  }
                />
              ))}
            </RowList>
          )}
          <Box className="savebar">
            {progress ? (
              <Stack gap={6}>
                <Progress value={progress.total ? (100 * progress.done) / progress.total : 0} />
                <Text size="sm" c="dimmed" className="num">
                  {progress.done} / {progress.total}
                </Text>
              </Stack>
            ) : (
              <Button size="md" fullWidth onClick={run} disabled={plan.every((r) => r.action === "skip")}>
                Import {plan.filter((r) => r.action !== "skip").length} founders
              </Button>
            )}
          </Box>
        </Section>
      )}
    </>
  );
}
