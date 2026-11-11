"use client";

import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Anchor, AppShell, Avatar, Button, Container, Group, Menu, Text, UnstyledButton } from "@mantine/core";
import { isStaffViewer } from "@shared/access";
import { useAuth } from "@/context/AuthContext";
import { paths } from "@/lib/paths";

// En-tete commun : le nom, et le visiteur (connexion ou menu de compte). Un
// batch pose sa propre navigation (BatchShell : onglets en bas sur mobile).
export function AppChrome({ children }: { children: ReactNode }) {
  return (
    <AppShell header={{ height: 52 }} padding={0}>
      <AppShell.Header withBorder style={{ background: "rgba(10, 10, 12, 0.92)", backdropFilter: "blur(12px)" }}>
        <Container size={760} px="md" h="100%">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Anchor component={Link} href={paths.home()} underline="never" c="white" fw={700} fz={15} lts={0.2}>
              Pioneers <Text span c="pioneers" inherit>Hub</Text>
            </Anchor>
            {/* `usePathname` suspend au pre-rendu (cacheComponents) : frontiere locale. */}
            <Suspense>
              <ViewerMenu />
            </Suspense>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main>
        <Container size={760} px="md" pt="md">
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

function ViewerMenu() {
  const { viewer, firebaseUser, isLoading, signOut } = useAuth();
  const pathname = usePathname();

  if (isLoading) return null;
  if (!firebaseUser) {
    if (pathname === "/signin") return null;
    return (
      <Button component={Link} href={paths.signIn(pathname)} variant="default">
        Sign in
      </Button>
    );
  }

  const name = firebaseUser.displayName ?? firebaseUser.email ?? "Account";
  return (
    <Menu position="bottom-end" withinPortal width={240}>
      <Menu.Target>
        <UnstyledButton aria-label="Account menu">
          <Avatar src={firebaseUser.photoURL} name={name} color="initials" size={32} radius="xl" />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Text size="sm" c="white" truncate>
            {name}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {firebaseUser.email}
            {isStaffViewer(viewer) ? " · Staff" : ""}
          </Text>
        </Menu.Label>
        <Menu.Item component={Link} href={paths.programs()}>
          Programs
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item onClick={() => signOut()}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
