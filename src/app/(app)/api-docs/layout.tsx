import { ApiKeysProvider } from "@/context/ApiKeysContext";

export default function ApiDocsLayout({ children }: LayoutProps<"/api-docs">) {
  return <ApiKeysProvider>{children}</ApiKeysProvider>;
}
