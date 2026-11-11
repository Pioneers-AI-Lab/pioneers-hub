import { ProgramProvider } from "@/context/ProgramContext";

export default function ProgramLayout({ children }: LayoutProps<"/programs/[programId]">) {
  return <ProgramProvider>{children}</ProgramProvider>;
}
