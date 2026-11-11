import { ClaimProvider } from "@/context/ClaimContext";

export default function ClaimLayout({ children }: LayoutProps<"/claim">) {
  return <ClaimProvider>{children}</ClaimProvider>;
}
