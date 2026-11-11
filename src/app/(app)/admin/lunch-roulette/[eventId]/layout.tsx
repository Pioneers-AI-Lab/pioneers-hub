import { AdminEventProvider } from "@/context/AdminEventContext";
import { paths } from "@/lib/paths";

export default function LunchRouletteEventLayout({ children }: LayoutProps<"/admin/lunch-roulette/[eventId]">) {
  return (
    <AdminEventProvider kind="matching" backHref={paths.adminLunchRoulette()}>
      {children}
    </AdminEventProvider>
  );
}
