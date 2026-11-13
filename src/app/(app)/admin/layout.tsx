import { AdminProvider } from "@/context/AdminContext";
import { ListsProvider } from "@/context/ListsContext";

// Garde de /admin : AdminProvider refuse tout compte sans role `staff`, et
// porte le batch de travail et ses listes pour tous les outils. Les listes
// fermees (competences, industries...) donnent leurs libelles aux reponses.
//
// Une page de liste de l'admin suit toujours le meme ordre : titre et
// description (`PageHeader`), choix du batch (`BatchPicker`, sauf Access qui
// n'en depend pas), la liste, puis « New … » colle en bas (`ActionBar`). Il
// ouvre la page d'un nouvel element (`…/new`), comme un clic sur une ligne
// ouvre celle d'un element existant (Access : la meme fenetre qu'un compte).
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <AdminProvider>
      <ListsProvider>{children}</ListsProvider>
    </AdminProvider>
  );
}
