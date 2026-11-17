import { getFirestore } from "firebase-admin/firestore";
import type { PublicForm } from "../shared/callables";
import { COL, docPaths } from "../shared/collections";
import { parisMonday, shiftWeek } from "../shared/dates";
import { activeQuestions, type Batch, type Form } from "../shared/types";
import { eventFormDocs } from "../shared/eventForms";
import { weeklyFormsPlan, type WeeklyFormsPlan } from "../shared/weeklyForms";

// ----------------------------
// services - les formulaires hebdomadaires (lot 4, shared/weeklyForms.ts)
// ----------------------------
// Appele chaque jeudi a 18:45 par la fonction programmee `weeklyForms` : pour chaque batch a venir
// ou en cours dont `settings.weeklyForms.enabled`, cree les deux formulaires de la semaine. Un
// formulaire deja la (relance, creation a la main par scripts/create-weekly-forms.mjs) est laisse
// tel quel : le staff a pu le modifier.

const db = () => getFirestore();

export type WeeklyFormsResult = Omit<WeeklyFormsPlan, "plans"> & { created: string[]; existing: string[] };

export async function createWeeklyForms(nowISO: string = new Date().toISOString()): Promise<WeeklyFormsResult[]> {
  const batches = await db().collection(COL.batches).where("status", "in", ["upcoming", "active"]).get();
  // Un batch sans le reglage n'est pas meme journalise.
  const enabled = batches.docs.filter((snap) => (snap.data() as Batch).settings?.weeklyForms?.enabled);
  return Promise.all(
    enabled.map(async (snap) => {
      const { plans, ...head } = weeklyFormsPlan({ ...(snap.data() as Batch), id: snap.id }, nowISO);
      // Les formulaires et leurs versions en une transaction : jamais par-dessus un existant.
      const existing = await db().runTransaction(async (tx) => {
        const found = plans.length ? await tx.getAll(...plans.map((p) => db().doc(docPaths.form(p.id)))) : [];
        const present = new Set(found.filter((d) => d.exists).map((d) => d.id));
        for (const p of plans) if (!present.has(p.id)) for (const d of eventFormDocs(p, nowISO)) tx.create(db().doc(d.path), d.data);
        return present;
      });
      return { ...head, created: plans.filter((p) => !existing.has(p.id)).map((p) => p.id), existing: [...existing] };
    }),
  );
}

/**
 * Le rappel du Weekly update founder (`getPublicForm`, §2.8) : l'objectif que le fondateur a donne
 * la semaine d'avant (`founderWeek.goalForWeek` de la semaine qui precede celle du formulaire), pour
 * la question qui ecrit `founderWeek.achieved`. `null` si le formulaire n'a pas cette question ou
 * s'il n'avait pas donne d'objectif.
 */
export async function previousGoalOf(form: Form, founderId: string, nowISO: string): Promise<PublicForm["previousGoal"]> {
  const question = activeQuestions(form).find((q) => q.dbField === "founderWeek.achieved");
  if (!question) return null;
  const week = shiftWeek(parisMonday(form.opensDateISOString ?? nowISO), -1);
  const goal = (await db().doc(docPaths.founderWeek(founderId, week)).get()).get("goalForWeek");
  return typeof goal === "string" && goal.trim() ? { questionId: question.id, goal: goal.trim() } : null;
}
