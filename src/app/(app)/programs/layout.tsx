import { ProgramsProvider } from "@/context/ProgramsContext";

export default function ProgramsLayout({ children }: LayoutProps<"/programs">) {
  return <ProgramsProvider>{children}</ProgramsProvider>;
}
