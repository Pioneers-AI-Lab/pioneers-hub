import Link from "next/link";
import { AnimatedBackdrop } from "@/components/auth/AnimatedBackdrop";
import { LocalDbBadge } from "@/components/chrome/LocalDbBadge";

// ----------------------------
// Pages de connexion : fond noir anime et logo Pioneers
// ----------------------------
// Hors de la coque de l'application (pas d'en-tete ni d'onglets). Le logo est
// le logo complet Pioneers Hub (`logo-pioneers-hub.svg`), version claire lisible sur noir.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="auth-page">
      <AnimatedBackdrop />
      <div className="auth-shell">
        <Link href="/" aria-label="Pioneers Hub" className="auth-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG statique, pas d'optimisation utile. */}
          <img src="/logo-pioneers-hub.svg" alt="Pioneers Hub" width={173} height={28} />
          <LocalDbBadge />
        </Link>
        <main className="auth-main">{children}</main>
      </div>
    </div>
  );
}
