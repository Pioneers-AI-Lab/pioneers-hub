import { StaffProvider } from "@/context/StaffContext";

// Garde du sous-arbre staff : StaffProvider refuse tout autre role.
export default function StaffLayout({ children }: LayoutProps<"/programs/[programId]/batches/[batchId]/staff">) {
  return <StaffProvider>{children}</StaffProvider>;
}
