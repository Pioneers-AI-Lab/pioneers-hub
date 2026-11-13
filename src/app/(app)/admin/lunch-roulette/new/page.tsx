import { redirect } from "next/navigation";
import { paths } from "@/lib/paths";

// Ancienne adresse : un nouvel evenement depuis son template (un pack), dans Admin > Events.
export default function Page() {
  redirect(paths.adminEventNew("lunch_roulette"));
}
