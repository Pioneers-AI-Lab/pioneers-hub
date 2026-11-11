"use client";

import { useState, type ReactNode } from "react";
import { Box, Button, Code, CopyButton, Group, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { API_KEY_NAME_MAX, API_PUBLIC_URL, MCP_PUBLIC_URL, OPENAPI_PUBLIC_URL } from "@shared/api";
import { useApiKeys } from "@/context/ApiKeysContext";
import { call } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Empty, Section } from "@/components/ui/Section";
import { Row, RowList } from "@/components/ui/Rows";
import { ExternalLink } from "@/components/ui/Field";

// ----------------------------
// API & MCP : brancher Claude, creer une cle, lire la reference
// ----------------------------
// Ouverte depuis le menu du compte (tout compte connecte : `canUseApi`, garde du layout).
// Le contenu suit ce que le serveur fait vraiment (functions/src/api, mcp,
// oauth) ; la reference complete et a jour est la spec OpenAPI, generee depuis
// les memes schemas que la validation.

/** Un bloc de code copiable, qui defile horizontalement au lieu de deborder (390 px). */
function CodeBlock({ code }: { code: string }) {
  return (
    <Box pos="relative">
      <Code block style={{ overflowX: "auto", whiteSpace: "pre", paddingRight: 72 }}>
        {code}
      </Code>
      <Box pos="absolute" top={6} right={6}>
        <CopyButton value={code}>
          {({ copied, copy }) => (
            <Button size="compact-xs" variant="default" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
        </CopyButton>
      </Box>
    </Box>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" className="num" w={16} style={{ flexShrink: 0 }}>
        {n}.
      </Text>
      <Text size="sm" style={{ minWidth: 0 }}>
        {children}
      </Text>
    </Group>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" fw={600} mt="sm">
      {children}
    </Text>
  );
}

// ---- Connecter Claude ----------------------------------------------------------

function ConnectClaude() {
  return (
    <Section
      title="Connect Claude"
      hint="Claude reads the batch data and fills it in with your rights. Every write is shown to you and confirmed first, and logged with your name. Nothing can be deleted."
    >
      <CodeBlock code={MCP_PUBLIC_URL} />

      <Label>claude.ai and Claude Desktop</Label>
      <Stack gap={6}>
        <Step n={1}>Open Settings, then Connectors, then Add custom connector.</Step>
        <Step n={2}>Name it Pioneers Hub and paste the address above.</Step>
        <Step n={3}>Click Connect, sign in with your Pioneers Hub account, then Allow.</Step>
      </Stack>
      <Text size="sm" c="dimmed">
        A connector added on claude.ai also shows up in Claude Desktop.
      </Text>

      <Label>Claude Code</Label>
      <CodeBlock code={`claude mcp add --transport http pioneers-hub ${MCP_PUBLIC_URL}`} />
      <Text size="sm" c="dimmed">
        Then type /mcp in Claude Code, pick pioneers-hub and sign in. No key is stored on your computer.
      </Text>

      <Label>What you can ask</Label>
      <RowList>
        <Row title="Look things up" subtitle="Founders, startups, events, notes, weekly updates" />
        <Row title="Fill in fields" subtitle="Profiles, weekly updates, attendance, submissions" />
        <Row title="Add notes" subtitle="Meeting notes on a startup or a founder" />
      </RowList>
    </Section>
  );
}

// ---- Cles d'API ----------------------------------------------------------------

function ApiKeys() {
  const { apiKeys, isLoading } = useApiKeys();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);

  /** Une action a la fois ; un refus s'affiche comme partout dans l'app (notification). */
  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    try {
      await action();
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    run("create", async () => {
      const { data } = await call("createApiKey")({ name: name.trim() });
      setCreated({ name: name.trim(), key: data.key });
      setName("");
    });

  const revoke = (keyId: string) =>
    run(keyId, async () => {
      await call("revokeApiKey")({ keyId });
    });

  return (
    <Section
      title="API keys"
      hint="For scripts and integrations (n8n, Zapier, Airtable). A key acts with your rights. Its value is shown only once."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void create();
        }}
      >
        <Stack gap="sm">
          <TextInput label="Key name" placeholder="n8n weekly import" maxLength={API_KEY_NAME_MAX} value={name} disabled={busy !== null} onChange={(e) => setName(e.currentTarget.value)} />
          <Button type="submit" size="md" fullWidth={false} loading={busy === "create"} disabled={!name.trim() || busy !== null}>
            Create key
          </Button>
        </Stack>
      </form>

      {created && (
        <Stack gap={6} mt="sm">
          <Text size="sm" fw={600}>
            {created.name}: copy it now, it will not be shown again.
          </Text>
          <CodeBlock code={created.key} />
        </Stack>
      )}

      {!isLoading && apiKeys.length === 0 ? (
        <Empty>No key yet.</Empty>
      ) : (
        <RowList>
          {apiKeys.map((k) => (
            <Row
              key={k.id}
              title={k.name}
              subtitle={`${k.prefix}... · created ${formatDateTime(k.createdDateISOString)} · ${k.lastUsedDateISOString ? `used ${formatDateTime(k.lastUsedDateISOString)}` : "never used"}`}
              meta={
                k.revokedDateISOString ? (
                  "Revoked"
                ) : (
                  <Button size="compact-sm" variant="default" loading={busy === k.id} disabled={busy !== null} onClick={() => void revoke(k.id)}>
                    Revoke
                  </Button>
                )
              }
            />
          ))}
        </RowList>
      )}
    </Section>
  );
}

// ---- Reference de l'API ------------------------------------------------------------

const ENDPOINTS: { route: string; what: string }[] = [
  { route: "GET /v1/me", what: "Your account, and the programs and batches with their ids" },
  { route: "GET /v1/{type}", what: "List programs, batches, founders, startups, events or notes" },
  { route: "GET /v1/{type}/{id}", what: "One object in full (a founder with their profile, a startup with its updates)" },
  { route: "GET /v1/fields", what: "Every writable field, the ids it needs and the values it accepts" },
  { route: "GET /v1/lists", what: "Accepted values of closed lists (skills, industries...)" },
  { route: "POST /v1/fields", what: "Write field values: profile, weekly update, attendance, submission" },
  { route: "POST /v1/notes", what: "Add an internal note to a startup or a founder" },
];

function ApiReference() {
  return (
    <Section title="REST API" hint="The same data and rules as Claude, for any tool. Authenticate with an API key.">
      <CodeBlock code={`${API_PUBLIC_URL}/v1`} />

      <Label>Endpoints</Label>
      <RowList>
        {ENDPOINTS.map((e) => (
          <Row key={e.route} title={<span className="num">{e.route}</span>} subtitle={e.what} />
        ))}
      </RowList>

      <Label>Read</Label>
      <CodeBlock code={`curl "${API_PUBLIC_URL}/v1/founders?batchId=fall-2026" \\\n  -H "Authorization: Bearer ph_live_..."`} />

      <Label>Write</Label>
      <Text size="sm" c="dimmed">
        Add ?dryRun=true to see what would change without writing. Send an Idempotency-Key header so that a retried request never writes twice. Empty values are refused: clear a field in the interface.
      </Text>
      <CodeBlock
        code={`curl -X POST "${API_PUBLIC_URL}/v1/fields?dryRun=true" \\\n  -H "Authorization: Bearer ph_live_..." \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: import-2026-11-16-row-12" \\\n  -d '{\n    "subjects": { "startupId": "...", "founderId": "...", "weekStartDayString": "2026-11-16" },\n    "values": { "checkin.revenue": 1200, "checkin.moral": 8 }\n  }'`}
      />

      <Label>Errors</Label>
      <Text size="sm" c="dimmed">
        A refusal names the field at fault and what to do: {"{ \"error\": { \"code\", \"message\", \"field\" } }"}.
      </Text>

      <Label>Full reference (OpenAPI)</Label>
      <Text size="sm">
        <ExternalLink href={OPENAPI_PUBLIC_URL} />
      </Text>
      <Text size="sm" c="dimmed">
        Generated from the same schemas that validate requests. Import it into Postman, n8n or any OpenAPI tool.
      </Text>
    </Section>
  );
}

export default function ApiDocsPage() {
  return (
    <>
      <PageHeader title="API & MCP" subtitle="Connect Claude to Pioneers Hub, or plug any tool into its API." />
      <ConnectClaude />
      <ApiKeys />
      <ApiReference />
    </>
  );
}
