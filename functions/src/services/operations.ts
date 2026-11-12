import { getFirestore, type Transaction } from "firebase-admin/firestore";
import type { z } from "zod";
import { COL } from "../shared/collections";
import type { IdempotencyRecord, WritePlan } from "../shared/types";
import type { Caller } from "../api/caller";
import { sha256 } from "../api/crypto";
import { badRequest, conflict, forbidden, fromZod, notFound } from "../api/errors";
import { writeAudit } from "./audit";

// ----------------------------
// services - une ECRITURE, et ses trois manieres d'etre appelee
// ----------------------------
// SPECS §4.7 : toute ecriture passe par une seule API, et chacune est validee,
// idempotente et tracee. Une `Operation` porte la regle metier UNE fois ; ce
// fichier la sert de trois facons :
//
//   runOperation     /v1 (et demain les callables) : apercu ou ecriture directe,
//                    `Idempotency-Key` verifiee DANS la transaction
//   previewPlan      MCP, 1er appel : calcule, stocke un `writePlan`, rend l'apercu
//   applyPlan        MCP, 2e appel : recalcule, refuse si l'etat a change depuis
//                    l'apercu, ecrit, marque le plan applique
//
// La forme d'une operation : `plan` LIT (dans la transaction) et rend un
// apercu plus une fonction `commit` qui ECRIT. Firestore exige toutes les
// lectures d'une transaction avant ses ecritures : cette coupe l'impose.

export type OperationPlan<R> = {
  /** Ce qui sera ecrit, tel que l'humain doit le voir avant de confirmer. */
  preview: unknown;
  /** Ecrit dans la transaction et rend le resultat. Absent si rien ne change. */
  commit: ((tx: Transaction) => R) | null;
  /** Chemins ecrits, pour le journal d'audit. */
  targetPaths: string[];
};

export type Operation<S extends z.ZodType = z.ZodType, R = unknown> = {
  name: string;
  input: S;
  /**
   * La porte grossiere : qui peut seulement tenter cette ecriture (le detail,
   * champ par champ, est verifie dans `plan`). Lue par les trois manieres
   * d'appeler ET par le catalogue MCP, qui n'affiche pas un outil refuse.
   */
  allowed(caller: Caller): boolean;
  // Syntaxe de METHODE, pas de propriete : ses parametres sont alors bivariants,
  // et une `Operation<typeof SetFieldsInput, ...>` se passe la ou l'on attend
  // une `Operation` sans cast.
  plan(tx: Transaction, caller: Caller, input: z.output<S>): Promise<OperationPlan<R>>;
};

// ---- Empreinte stable ---------------------------------------------------------

/** JSON a cles triees a toute profondeur : deux ordres de champs, une empreinte. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Copie JSON pure : Firestore refuse les `undefined`. */
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_TTL_MS = 60 * 60 * 1000;

function assertAllowed(op: Operation<z.ZodType, unknown>, caller: Caller) {
  if (!op.allowed(caller)) throw forbidden("not_allowed", `Your account cannot use \`${op.name}\`.`);
}

function parseInput<S extends z.ZodType>(op: Operation<S>, raw: unknown): z.output<S> {
  const parsed = op.input.safeParse(raw);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
}

function commitWithAudit<R>(
  tx: Transaction,
  caller: Caller,
  action: string,
  input: unknown,
  plan: OperationPlan<R>,
  idempotencyKey: string | null,
): R | null {
  if (!plan.commit) return null;
  const result = plan.commit(tx);
  writeAudit(tx, caller, {
    action,
    targetPath: plan.targetPaths.join(", ").slice(0, 1500),
    payload: { input },
    idempotencyKey,
  });
  return result;
}

// ---- /v1 -----------------------------------------------------------------------

export type RunResult<R> = { applied: boolean; preview: unknown; result: R | null; replayed: boolean };

export async function runOperation<S extends z.ZodType, R>(
  op: Operation<S, R>,
  caller: Caller,
  raw: unknown,
  options: { dryRun: boolean; idempotencyKey: string | null },
): Promise<RunResult<R>> {
  assertAllowed(op, caller);
  const input = parseInput(op, raw);
  const db = getFirestore();

  if (options.dryRun) {
    return db.runTransaction(
      async (tx) => {
        const plan = await op.plan(tx, caller, input);
        return { applied: false, preview: plan.preview, result: null, replayed: false };
      },
      { readOnly: true },
    );
  }

  const key = options.idempotencyKey;
  if (key !== null && (key.length === 0 || key.length > 255)) {
    throw badRequest("invalid_idempotency_key", "`Idempotency-Key` must be 1 to 255 characters.", "Idempotency-Key");
  }
  const idem = key
    ? {
        ref: db.collection(COL.idempotencyKeys).doc(sha256(`${caller.uid}\n${key}`)),
        requestHash: sha256(stableStringify({ op: op.name, input })),
      }
    : null;

  return db.runTransaction(async (tx) => {
    if (idem) {
      const record = (await tx.get(idem.ref)).data() as IdempotencyRecord | undefined;
      if (record && Date.parse(record.expiresDateISOString) > Date.now()) {
        if (record.requestHash !== idem.requestHash) {
          throw conflict("idempotency_conflict", "This `Idempotency-Key` was already used for a different request.");
        }
        return record.result as RunResult<R>;
      }
    }

    const plan = await op.plan(tx, caller, input);
    const result = commitWithAudit(tx, caller, op.name, input, plan, key);
    const out: RunResult<R> = { applied: plan.commit !== null, preview: plan.preview, result, replayed: false };

    if (idem) {
      const now = Date.now();
      const record: IdempotencyRecord = {
        ownerUid: caller.uid,
        operation: op.name,
        requestHash: idem.requestHash,
        result: { ...out, replayed: true },
        createdDateISOString: new Date(now).toISOString(),
        expiresDateISOString: new Date(now + DAY_MS).toISOString(),
      };
      tx.set(idem.ref, plain(record));
    }
    return out;
  });
}

// ---- MCP : apercu puis confirmation ------------------------------------------

export async function previewPlan<S extends z.ZodType, R>(
  op: Operation<S, R>,
  caller: Caller,
  raw: unknown,
): Promise<{ planId: string | null; preview: unknown }> {
  assertAllowed(op, caller);
  const input = parseInput(op, raw);
  const db = getFirestore();
  const plan = await db.runTransaction((tx) => op.plan(tx, caller, input), { readOnly: true });
  // Rien a ecrire : pas de plan a confirmer.
  if (!plan.commit) return { planId: null, preview: plan.preview };

  const now = Date.now();
  const ref = db.collection(COL.writePlans).doc();
  const doc: WritePlan = {
    ownerUid: caller.uid,
    operation: op.name,
    input: input as Record<string, unknown>,
    preview: plan.preview,
    result: null,
    status: "previewed",
    createdDateISOString: new Date(now).toISOString(),
    expiresDateISOString: new Date(now + PLAN_TTL_MS).toISOString(),
    appliedDateISOString: null,
  };
  await ref.set(plain(doc));
  return { planId: ref.id, preview: plan.preview };
}

export async function applyPlan<S extends z.ZodType, R>(
  op: Operation<S, R>,
  caller: Caller,
  planId: string,
): Promise<{ result: R | null; replayed: boolean }> {
  assertAllowed(op, caller);
  const db = getFirestore();
  const ref = db.collection(COL.writePlans).doc(planId);

  return db.runTransaction(async (tx) => {
    const plan = (await tx.get(ref)).data() as WritePlan | undefined;
    if (!plan) throw notFound("plan_not_found", "This plan does not exist. Call the tool again without `planId` to preview.", "planId");
    if (plan.ownerUid !== caller.uid) throw forbidden("plan_not_yours", "This plan was previewed by another account.");
    if (plan.operation !== op.name) {
      throw badRequest("plan_mismatch", `This plan belongs to \`${plan.operation}\`, not to \`${op.name}\`.`, "planId");
    }
    if (plan.status === "applied") return { result: plan.result as R, replayed: true };
    if (Date.parse(plan.expiresDateISOString) < Date.now()) {
      throw conflict("plan_expired", "This preview is older than one hour. Preview again, then confirm.");
    }

    const input = parseInput(op, plan.input);
    const fresh = await op.plan(tx, caller, input);

    // ⛔️ CE QUI EST ECRIT EST CE QUI A ETE MONTRE. Si la base a bouge entre
    // l'apercu et la confirmation (un formulaire, un autre membre du staff),
    // on refuse plutot que d'ecrire autre chose que ce que l'humain a valide.
    // (`stableStringify` ignore les `undefined`, comme la copie stockee.)
    if (stableStringify(fresh.preview) !== stableStringify(plan.preview)) {
      throw conflict("plan_stale", "The data changed since the preview. Preview again and show the new result before confirming.");
    }

    const result = commitWithAudit(tx, caller, op.name, input, fresh, planId);
    tx.update(ref, { status: "applied", result: plain(result), appliedDateISOString: new Date().toISOString() });
    return { result, replayed: false };
  });
}
