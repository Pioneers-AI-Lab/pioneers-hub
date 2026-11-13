import { redirect } from "next/navigation";
import { paths } from "@/lib/paths";

// Ancienne adresse : le tirage de l'evenement est sous sa page (Admin > Events > l'evenement > matching).
export default async function Page({ params }: PageProps<"/admin/lunch-roulette/[eventId]">) {
  redirect(paths.adminEventMatching((await params).eventId));
}
