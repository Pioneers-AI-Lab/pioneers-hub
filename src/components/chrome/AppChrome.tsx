"use client";

import Link from "next/link";
import { Suspense, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Anchor, AppShell, Avatar, Box, Button, Container, Drawer, Group, Menu, Stack, Text, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { canUseApi, isStaffViewer } from "@shared/access";
import { APP_NAME } from "@shared/brand";
import { useAuth } from "@/context/AuthContext";
import { paths } from "@/lib/paths";
import { BOTTOM_SHEET_STYLES, MOBILE_QUERY } from "@/components/ui/ResponsiveDialog";
import { AppLogo } from "@/components/chrome/AppLogo";
import { LocalDbBadge } from "@/components/chrome/LocalDbBadge";

// En-tete commun : le nom, et le visiteur (connexion ou compte). Un batch pose
// sa propre navigation (BatchShell : onglets en bas sur mobile).
// Mobile d'abord : zones tactiles de 44 px, marges des encoches (paysage).
export function AppChrome({ children }: { children: ReactNode }) {
  return (
    <AppShell header={{ height: 52 }} padding={0}>
      <AppShell.Header
        withBorder
        style={{
          background: "rgba(10, 10, 12, 0.92)",
          backdropFilter: "blur(12px)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <Container size={760} px="md" h="100%">
          <Group h="100%" justify="space-between" wrap="nowrap">
            {/* Logo Pioneers Founder Hub (le meme que les pages de connexion) : symbole,
                « pioneers » et « Founder Hub », version claire lisible sur noir. */}
            <Anchor
              component={Link}
              href={paths.home()}
              aria-label={APP_NAME}
              underline="never"
              h={44}
              px="xs"
              mx="calc(-1 * var(--mantine-spacing-xs))"
              className="state-layer"
              style={{ display: "inline-flex", alignItems: "center", borderRadius: "var(--mantine-radius-md)" }}
            >
              <AppLogo height={22} />
              <LocalDbBadge />
            </Anchor>
            {/* `usePathname` suspend au pre-rendu (cacheComponents) : frontiere locale. */}
            <Suspense>
              <ViewerMenu />
            </Suspense>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main>
        <Container size={760} px="md" style={{ paddingTop: "var(--app-content-pt)", paddingLeft: "max(var(--mantine-spacing-md), env(safe-area-inset-left))", paddingRight: "max(var(--mantine-spacing-md), env(safe-area-inset-right))" }}>
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

type AccountLink = { label: string; href: string };

/** Le bouton du compte (avatar), mobile et ordinateur : 44 px, rond, voile d'etat (globals.css). */
const ACCOUNT_TRIGGER = {
  "aria-label": "Account menu",
  w: 44,
  h: 44,
  className: "state-layer",
  style: { display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%" },
} as const;

/**
 * Le compte : une feuille qui monte du bas sur mobile (lignes de 52 px a
 * portee de pouce), un menu deroulant sur ordinateur (a la souris).
 */
function ViewerMenu() {
  const { viewer, firebaseUser, isLoading, memberships, signOut } = useAuth();
  const pathname = usePathname();
  const isMobile = useMediaQuery(MOBILE_QUERY) ?? false;
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isLoading) return null;
  if (!firebaseUser) {
    if (pathname === "/signin") return null;
    return (
      <Button component={Link} href={paths.signIn(pathname)} variant="default" size="sm" h={40}>
        Sign in
      </Button>
    );
  }

  const name = firebaseUser.displayName ?? firebaseUser.email ?? "Account";
  const isStaff = isStaffViewer(viewer);
  // « Me » : le profil fondateur du dernier batch rattache (un compte peut etre
  // fondateur de plusieurs batchs ; le plus recent est celui qu'on vit).
  const latest = [...memberships].sort((a, b) => b.createdDateISOString.localeCompare(a.createdDateISOString))[0];
  const links: AccountLink[] = [
    ...(latest
      ? [
          { label: "Me", href: paths.me(latest.programId, latest.batchId) },
          { label: "Edit my profile", href: paths.meEdit(latest.programId, latest.batchId) },
        ]
      : []),
    { label: "Programs", href: paths.programs() },
    ...(isStaff ? [{ label: "Admin", href: paths.admin() }] : []),
    ...(canUseApi(viewer) ? [{ label: "API & MCP", href: paths.apiDocs() }] : []),
  ];
  const avatar = <Avatar src={firebaseUser.photoURL} name={name} color="initials" size={32} radius="xl" />;
  const identity = (
    <>
      <Text size="sm" c="white" fw={600} truncate>
        {name}
      </Text>
      <Text size="xs" c="dimmed" truncate>
        {firebaseUser.email}
        {isStaff ? " · Staff" : ""}
      </Text>
    </>
  );

  if (isMobile) {
    return (
      <>
        <UnstyledButton {...ACCOUNT_TRIGGER} onClick={() => setSheetOpen(true)}>
          {avatar}
        </UnstyledButton>
        <Drawer
          opened={sheetOpen}
          onClose={() => setSheetOpen(false)}
          position="bottom"
          size="auto"
          withCloseButton={false}
          styles={{
            ...BOTTOM_SHEET_STYLES,
            body: { padding: "8px 16px calc(16px + env(safe-area-inset-bottom))" },
          }}
        >
          {/* Poignee : la feuille se ferme en touchant hors d'elle. */}
          <Box mx="auto" mt={4} mb="sm" w={36} h={4} bg="dark.4" style={{ borderRadius: 99 }} />
          <Group gap="sm" wrap="nowrap" pb="md" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
            <Avatar src={firebaseUser.photoURL} name={name} color="initials" size={44} radius="xl" />
            <Stack gap={0} style={{ minWidth: 0 }}>
              {identity}
            </Stack>
          </Group>
          <Stack gap={0}>
            {links.map((l) => (
              <Link key={l.label} href={l.href} className="row state-layer" style={{ minHeight: 52 }} onClick={() => setSheetOpen(false)}>
                <Text fw={500}>{l.label}</Text>
              </Link>
            ))}
            <button
              type="button"
              className="row state-layer"
              style={{ minHeight: 52 }}
              onClick={() => {
                setSheetOpen(false);
                void signOut();
              }}
            >
              <Text fw={500} c="red.4">
                Sign out
              </Text>
            </button>
          </Stack>
        </Drawer>
      </>
    );
  }

  return (
    <Menu position="bottom-end" withinPortal width={240}>
      <Menu.Target>
        <UnstyledButton {...ACCOUNT_TRIGGER}>
          {avatar}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{identity}</Menu.Label>
        {links.map((l) => (
          <Menu.Item key={l.label} component={Link} href={l.href}>
            {l.label}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item onClick={() => signOut()}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
