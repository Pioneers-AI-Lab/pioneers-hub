import { getFirestore } from "firebase-admin/firestore";
import type { PublicForm } from "../shared/callables";
import { COL, docPaths } from "../shared/collections";
import { parisMonday } from "../shared/dates";
import { activeQuestions, type Form } from "../shared/types";

// ----------------------------
// services - le rappel du Weekly update founder (lot 4, shared/weeklyForms.ts)
// ----------------------------
// Les formulaires eux-memes naissent avec leur entree « Weekly Update Form » de l'agenda
// (synchro, services/calendarSync.ts ; rattrapage scripts/attach-weekly-forms.mjs).

const db = () => getFirestore();

/** La question qui recoit le rappel : « What did you achieve? ». */
const ACHIEVED_FIELD = "founderWeek.achieved";
const asksAchieved = (form: Pick<Form, "questions">) => activeQuestions(form).find((q) => q.dbField === ACHIEVED_FIELD);

/**
 * Le rappel du Weekly update founder (`getPublicForm`, §2.8) : l'objectif que le fondateur a donne
 * au Weekly update founder PRECEDENT du batch (`founderWeek.goalForWeek` de la semaine ou il a ouvert),
 * quel que soit l'ecart entre les deux (une semaine sans entree dans l'agenda). `null` si le
 * formulaire n'a pas la question, s'il est le premier, ou sans objectif donne.
 */
export async function previousGoalOf(form: Form, founderId: string, nowISO: string): Promise<PublicForm["previousGoal"]> {
  const question = asksAchieved(form);
  if (!question) return null;
  const opens = form.opensDateISOString ?? nowISO;
  const siblings = await db()
    .collection(COL.forms)
    .where("batchId", "==", form.batchId)
    .where("kind", "==", form.kind)
    .select("questions", "status", "archivedDateISOString", "opensDateISOString")
    .get();
  const previous = siblings.docs
    .map((d) => d.data() as Pick<Form, "questions" | "status" | "archivedDateISOString" | "opensDateISOString">)
    .filter((f) => f.archivedDateISOString === null && f.status !== "draft" && f.opensDateISOString !== null && f.opensDateISOString < opens && asksAchieved(f))
    .reduce<string | null>((latest, f) => (latest === null || f.opensDateISOString! > latest ? f.opensDateISOString : latest), null);
  if (!previous) return null;
  const goal = (await db().doc(docPaths.founderWeek(founderId, parisMonday(previous))).get()).get("goalForWeek");
  return typeof goal === "string" && goal.trim() ? { questionId: question.id, goal: goal.trim() } : null;
}
