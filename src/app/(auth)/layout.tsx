import Link from "next/link";
import { AnimatedBackdrop } from "@/components/auth/AnimatedBackdrop";

// ----------------------------
// Pages de connexion : fond noir anime et logo Pioneers
// ----------------------------
// Hors de la coque de l'application (pas d'en-tete ni d'onglets). Le logo est
// la version claire de la marque (`logo-pioneers.svg` du site), lisible sur noir.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="auth-page">
      <AnimatedBackdrop />
      <div className="auth-shell">
        <Link href="/" aria-label="Pioneers Hub" className="auth-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG statique, pas d'optimisation utile. */}
          <img src="/logo-pioneers.svg" alt="Pioneers" width={154} height={28} />
        </Link>
        <main className="auth-main">{children}</main>
      </div>
    </div>
  );
}
