import Link from "next/link";
import { AnimatedBackdrop } from "@/components/auth/AnimatedBackdrop";
import { APP_NAME } from "@shared/brand";
import { AppLogo } from "@/components/chrome/AppLogo";
import { LocalDbBadge } from "@/components/chrome/LocalDbBadge";

// ----------------------------
// Pages de connexion : fond noir anime et logo Pioneers
// ----------------------------
// Hors de la coque de l'application (pas d'en-tete ni d'onglets). Le logo est
// le logo complet Pioneers Founder Hub (`AppLogo`), version claire lisible sur noir.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="auth-page">
      <AnimatedBackdrop />
      <div className="auth-shell">
        <Link href="/" aria-label={APP_NAME} className="auth-logo">
          <AppLogo height={28} />
          <LocalDbBadge />
        </Link>
        <main className="auth-main">{children}</main>
      </div>
    </div>
  );
}
