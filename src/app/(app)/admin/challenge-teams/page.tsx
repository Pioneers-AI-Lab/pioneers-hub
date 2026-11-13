import { redirect } from "next/navigation";
import { paths } from "@/lib/paths";

// Ancienne adresse : les evenements et leur matching sont dans Admin > Events (decision du 13/11).
export default function Page() {
  redirect(paths.adminEvents());
}
