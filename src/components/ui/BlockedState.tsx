import Link from "next/link";
import { Button, Center, Stack, Text, Title } from "@mantine/core";

const COPY = {
  not_found: { title: "Not found", body: "This page does not exist, or it has been archived." },
  forbidden: { title: "Access restricted", body: "You do not have access to this page. Sign in, or ask the Pioneers team." },
  error: { title: "Something went wrong", body: "The data could not be loaded. Try again in a moment." },
} as const;

export type BlockedReason = keyof typeof COPY;

/** Ce qu'un niveau affiche quand son document manque ou est refuse. La sortie vise le parent. */
export function BlockedState({ reason, backHref }: { reason: BlockedReason; backHref: string }) {
  const { title, body } = COPY[reason];
  return (
    <Center mih={320} px="md">
      <Stack align="center" gap="xs" maw={420}>
        <Title order={3}>{title}</Title>
        <Text c="dimmed" ta="center">
          {body}
        </Text>
        <Button component={Link} href={backHref} variant="default" mt="sm" size="md">
          Back
        </Button>
      </Stack>
    </Center>
  );
}

/** Traduit l'erreur d'un ecouteur en raison d'affichage. */
export function reasonFromError(error: { code: string } | null): BlockedReason {
  if (!error) return "not_found";
  return error.code === "permission-denied" ? "forbidden" : "error";
}
