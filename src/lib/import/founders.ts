import { arrayUnion, doc, getDoc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { parseDbField } from "@shared/fieldRegistry";
import type { Batch, Founder, FounderDirectory, FounderInternal, FounderProfile, Person, WithId } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";
import { addListValues } from "@/lib/batchAdmin";
import { targetSpec, type ImportFieldKey, type ImportTarget } from "./targets";
import { convertCell } from "./values";

// ----------------------------
// Import des fondateurs depuis le CSV d'onboarding (SPECS §3.2)
// ----------------------------
// 1. `parseRows`  : chaque ligne -> email, nom, valeurs typees, erreurs.
// 2. `planImport` : dedoublonnage par EMAIL (cle du rattachement de compte) :
//      create          personne et fondateur nouveaux
//      add_to_batch    la personne existe (autre batch) : nouveau fondateur, meme identite
//      fill_existing   deja dans ce batch : on ne remplit QUE les champs vides
//                      (regle `fill_empty` du registre, listes fusionnees)
//      skip            sans email, ou email en double dans le fichier
// 3. `applyImport` : ecrit par lots. Sans Cloud Functions pour l'instant,
//    l'import ecrit aussi les COPIES (nom et photo sur `founders`, email,
//    WhatsApp, LinkedIn sur `private/directory`).

export type ColumnMapping = Record<string, ImportTarget | null>;

export type ParsedRow = {
  line: number;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  values: Partial<Record<ImportFieldKey, unknown>>;
  errors: string[];
};

export type ImportAction = "create" | "add_to_batch" | "fill_existing" | "skip";

export type PlannedRow = ParsedRow & {
  action: ImportAction;
  skipReason: string | null;
  existingPersonId: string | null;
  existingFounderId: string | null;
};

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

export function parseRows(rows: Record<string, string>[], mapping: ColumnMapping): ParsedRow[] {
  return rows.map((row, i) => {
    const parsed: ParsedRow = { line: i + 2, email: null, firstName: null, lastName: null, values: {}, errors: [] };
    for (const [column, target] of Object.entries(mapping)) {
      if (!target) continue;
      const raw = row[column]?.trim() ?? "";
      if (target === "email") {
        parsed.email = raw ? raw.toLowerCase() : null;
      } else if (target === "fullName") {
        if (raw) {
          const [first, ...rest] = raw.split(/\s+/);
          parsed.firstName ??= first;
          parsed.lastName ??= rest.join(" ") || null;
        }
      } else {
        const converted = convertCell(target, targetSpec(target), raw);
        if (converted.ok) {
          if (converted.value !== null) parsed.values[target] = converted.value;
        } else {
          parsed.errors.push(`${column}: ${converted.reason}`);
        }
      }
    }
    // Prenom et nom explicites l'emportent sur le decoupage du nom complet.
    if (typeof parsed.values["person.firstName"] === "string") parsed.firstName = parsed.values["person.firstName"];
    if (typeof parsed.values["person.lastName"] === "string") parsed.lastName = parsed.values["person.lastName"];
    if (parsed.email && !/.+@.+\..+/.test(parsed.email)) {
      parsed.errors.push(`Email "${parsed.email}" is not valid`);
      parsed.email = null;
    }
    return parsed;
  });
}

/** Personnes deja en base, par email (requetes `in` de 30). */
async function peopleByEmail(emails: string[]): Promise<Map<string, WithId<Person>>> {
  const found = new Map<string, WithId<Person>>();
  for (let i = 0; i < emails.length; i += 30) {
    const chunk = emails.slice(i, i + 30);
    const snap = await getDocs(query(refs.people(), where("email", "in", chunk)));
    for (const d of snap.docs) found.set(d.data().email, d.data());
  }
  return found;
}

export async function planImport(rows: ParsedRow[], foundersOfBatch: WithId<Founder>[]): Promise<PlannedRow[]> {
  const emails = [...new Set(rows.map((r) => r.email).filter((e): e is string => !!e))];
  const people = await peopleByEmail(emails);
  const seen = new Set<string>();

  return rows.map((row) => {
    const base = { ...row, existingPersonId: null, existingFounderId: null, skipReason: null };
    if (!row.email) return { ...base, action: "skip", skipReason: "No email" };
    if (seen.has(row.email)) return { ...base, action: "skip", skipReason: "Email already in this file" };
    seen.add(row.email);
    const person = people.get(row.email);
    if (!person) {
      if (!row.firstName) return { ...base, action: "skip", skipReason: "No name" };
      return { ...base, action: "create" };
    }
    const founder = foundersOfBatch.find((f) => f.personId === person.id);
    if (founder) return { ...base, action: "fill_existing", existingPersonId: person.id, existingFounderId: founder.id };
    return { ...base, action: "add_to_batch", existingPersonId: person.id };
  });
}

// ---- Ecriture -----------------------------------------------------------------

/** Les valeurs d'une ligne, rangees par document. */
function byDoc(values: ParsedRow["values"]) {
  const docs: Record<"person" | "founder" | "founderDirectory" | "founderProfile", Record<string, unknown>> = {
    person: {},
    founder: {},
    founderDirectory: {},
    founderProfile: {},
  };
  for (const [key, value] of Object.entries(values)) {
    const { doc: kind, field } = parseDbField(key as ImportFieldKey);
    (docs as Record<string, Record<string, unknown>>)[kind][field] = value;
  }
  return docs;
}

const emptyDirectory = (email: string): FounderDirectory => ({
  email,
  whatsapp: null,
  linkedinUrl: null,
  gender: null,
  nationality: null,
  country: null,
  introduceYourself: null,
  education: null,
  degree: null,
  fieldOfStudy: null,
  yearsOfXP: null,
  notableCompanies: [],
  trackRecord: null,
  trackRecord3Liners: [],
  interestedInWorkingOn: null,
  hasExistingProject: null,
  projectExplanation: null,
  hasExistingCoFounders: null,
  openToJoinAnotherProject: null,
  mainStartup2025: null,
  lookingForCoFounder: null,
  coFounderTypeWanted: null,
  coFounderSkillsWanted: [],
  industriesToExplore: [],
});

const emptyProfile = (): FounderProfile => ({
  age: null,
  birthDayString: null,
  housingSupport: null,
  tShirtSize: null,
  enrolmentConfirmed: null,
});

/** Ne garde que les valeurs qui remplissent un champ vide ; les listes sont fusionnees sans doublon. */
function fillEmpty(current: Record<string, unknown> | undefined, incoming: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(incoming)) {
    const existing = current?.[field];
    if (Array.isArray(value) && Array.isArray(existing)) {
      const merged = [...new Set([...existing, ...value])];
      if (merged.length !== existing.length) patch[field] = merged;
    } else if (isEmpty(existing)) {
      patch[field] = value;
    }
  }
  return patch;
}

export type ImportResult = { created: number; addedToBatch: number; filled: number; skipped: number; listValuesAdded: number };

export async function applyImport(
  plan: PlannedRow[],
  batch: WithId<Batch>,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, addedToBatch: 0, filled: 0, skipped: 0, listValuesAdded: 0 };
  const scoped = { programId: batch.programId, batchId: batch.id };
  const todo = plan.filter((r) => r.action !== "skip");
  result.skipped = plan.length - todo.length;

  // ~6 ecritures par ligne : 60 lignes par lot restent sous la limite de 500.
  for (let i = 0; i < todo.length; i += 60) {
    const writes = writeBatch(db);
    for (const row of todo.slice(i, i + 60)) {
      const now = new Date().toISOString();
      const docs = byDoc(row.values);
      const firstName = row.firstName ?? "";
      const lastName = row.lastName ?? "";
      const displayName = [firstName, lastName].filter(Boolean).join(" ");
      const email = row.email!;

      if (row.action === "fill_existing") {
        const founderId = row.existingFounderId!;
        const personId = row.existingPersonId!;
        const [founder, directory, profile, person] = await Promise.all([
          getDoc(refs.founder(founderId)).then((s) => s.data()),
          getDoc(refs.founderDirectory(founderId)).then((s) => s.data()),
          getDoc(refs.founderProfile(founderId)).then((s) => s.data()),
          getDoc(refs.person(personId)).then((s) => s.data()),
        ]);
        const personPatch = fillEmpty(person as Record<string, unknown> | undefined, docs.person);
        const founderPatch = fillEmpty(founder as Record<string, unknown> | undefined, docs.founder);
        // Copies a jour si l'original vient d'etre rempli.
        if (personPatch.photoUrl && !founder?.photoUrl) founderPatch.photoUrl = personPatch.photoUrl;
        const directoryPatch = fillEmpty(directory as Record<string, unknown> | undefined, {
          ...docs.founderDirectory,
          ...(personPatch.whatsapp ? { whatsapp: personPatch.whatsapp } : {}),
          ...(personPatch.linkedinUrl ? { linkedinUrl: personPatch.linkedinUrl } : {}),
          ...(personPatch.phone ? { phone: personPatch.phone } : {}),
        });
        const profilePatch = fillEmpty(profile as Record<string, unknown> | undefined, docs.founderProfile);
        if (Object.keys(personPatch).length) writes.set(refs.person(personId), { ...personPatch, updatedDateISOString: now }, { merge: true });
        if (Object.keys(founderPatch).length) writes.set(refs.founder(founderId), { ...founderPatch, updatedDateISOString: now }, { merge: true });
        if (Object.keys(directoryPatch).length) writes.set(refs.founderDirectory(founderId), directoryPatch, { merge: true });
        if (Object.keys(profilePatch).length) writes.set(refs.founderProfile(founderId), profilePatch, { merge: true });
        result.filled++;
        continue;
      }

      const founderId = doc(refs.founders()).id;
      let personId = row.existingPersonId;
      let photoUrl = (docs.person.photoUrl as string | undefined) ?? null;
      let whatsapp = (docs.person.whatsapp as string | undefined) ?? null;
      let linkedinUrl = (docs.person.linkedinUrl as string | undefined) ?? null;
      let phone = (docs.person.phone as string | undefined) ?? null;
      let slackUserId: string | null = null;
      let name = displayName;

      if (row.action === "create") {
        personId = doc(refs.people()).id;
        const person: Person = {
          createdDateISOString: now,
          updatedDateISOString: now,
          archivedDateISOString: null,
          firstName,
          lastName,
          displayName,
          email,
          altEmails: [],
          phone,
          whatsapp,
          linkedinUrl,
          photoUrl,
          slackUserId: null,
          uid: null,
          founderIds: [founderId],
          mentorId: null,
          investorId: null,
        };
        writes.set(refs.person(personId), { ...person, id: personId });
        result.created++;
      } else {
        // La personne existe : son identite fait foi, on ne la reecrit pas.
        const person = (await getDoc(refs.person(personId!))).data();
        photoUrl = person?.photoUrl ?? photoUrl;
        whatsapp = person?.whatsapp ?? whatsapp;
        linkedinUrl = person?.linkedinUrl ?? linkedinUrl;
        phone = person?.phone ?? phone;
        slackUserId = person?.slackUserId ?? null;
        name = person?.displayName || name;
        writes.set(refs.person(personId!), { founderIds: arrayUnion(founderId), updatedDateISOString: now }, { merge: true });
        result.addedToBatch++;
      }

      const founder: Founder = {
        ...scoped,
        createdDateISOString: now,
        updatedDateISOString: now,
        archivedDateISOString: null,
        personId: personId!,
        uid: null,
        claimedDateISOString: null,
        name,
        photoUrl,
        profileCategory: (docs.founder.profileCategory as Founder["profileCategory"] | undefined) ?? null,
        hardSkills: (docs.founder.hardSkills as string[] | undefined) ?? [],
        industries: (docs.founder.industries as string[] | undefined) ?? [],
        rolesICouldTake: (docs.founder.rolesICouldTake as string[] | undefined) ?? [],
        trackRecordOneLiner: null,
        startupId: null,
        status: "enrolled",
        leftProgramReason: null,
        isExternalFounder: false,
        publicProfileConsent: false,
        stats: null,
      };
      const internal: FounderInternal = { eloScore: null, eloMatchesCount: 0 };
      writes.set(refs.founder(founderId), { ...founder, id: founderId });
      writes.set(refs.founderDirectory(founderId), {
        ...emptyDirectory(email),
        ...docs.founderDirectory,
        whatsapp,
        linkedinUrl,
        // Copies de `people` (PERSON_COPIES) : coordonnees visibles du batch.
        phone,
        slackUserId,
        id: "directory",
      } as WithId<FounderDirectory>);
      writes.set(refs.founderProfile(founderId), { ...emptyProfile(), ...docs.founderProfile, id: "profile" } as WithId<FounderProfile>);
      writes.set(refs.founderInternal(founderId), { ...internal, id: "internal" });
    }
    await writes.commit();
    onProgress?.(Math.min(i + 60, todo.length), todo.length);
  }

  // Les valeurs nouvelles de competences, secteurs et roles rejoignent les listes fermees.
  const collect = (key: ImportFieldKey) => todo.flatMap((r) => (r.values[key] as string[] | undefined) ?? []);
  result.listValuesAdded =
    (await addListValues("hardSkills", collect("founder.hardSkills"))) +
    (await addListValues("industries", collect("founder.industries"))) +
    (await addListValues("positionFit", collect("founder.rolesICouldTake")));
  return result;
}
