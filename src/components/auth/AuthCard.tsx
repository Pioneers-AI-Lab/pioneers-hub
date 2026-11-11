import type { ReactNode } from "react";
import { Stack, Text, Title } from "@mantine/core";

/** La carte des pages de connexion : un titre, une phrase, le formulaire, un lien de bas de carte. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="auth-card">
      <Stack gap="lg">
        <Stack gap={6}>
          <Title order={2}>{title}</Title>
          {subtitle && <Text c="dimmed" size="sm">{subtitle}</Text>}
        </Stack>
        {children}
        {footer && (
          <Text size="sm" c="dimmed" ta="center">
            {footer}
          </Text>
        )}
      </Stack>
    </div>
  );
}
