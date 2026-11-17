// Lock my team -> startups (lot 2, docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §2.10) : une equipe
// n'est proposee que si ses reponses sont RECIPROQUES (chacun a dit oui et cite exactement les
// autres) ; le reste est a verifier ; « non » = sans equipe. Puis la creation des startups.
// Logique pure : functions/lib/shared/teamLocks.js.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { check } from "../lib/check.mjs";

const require = createRequire(import.meta.url);
const { groupTeamLocks, startupCreationWrites, startupIdFor } = require("../../functions/lib/shared/teamLocks.js");

const yes = (founderId, coFounderIds, startupName = null) => ({ founderId, locked: true, coFounderIds, startupName });
const no = (founderId) => ({ founderId, locked: false, coFounderIds: [], startupName: null });
const keys = (groups) => groups.proposed.map((t) => t.key);

check("trois fondateurs, une equipe reciproque : proposee une fois", () => {
  const g = groupTeamLocks([yes("ada", ["ben", "chloe"], "Lumen"), yes("ben", ["chloe", "ada"]), yes("chloe", ["ada", "ben"], "lumen")]);
  assert.deepEqual(keys(g), ["ada+ben+chloe"]);
  assert.deepEqual(g.proposed[0].memberIds, ["ada", "ben", "chloe"]);
  assert.deepEqual(g.proposed[0].startupNames, ["Lumen"]); // casse ignoree, sans doublon
  assert.deepEqual(g.partial, []);
});

check("une paire reciproque, a cote d'une reponse a sens unique", () => {
  const g = groupTeamLocks([yes("ada", ["ben"]), yes("ben", ["ada"]), yes("dan", ["ada"])]);
  assert.deepEqual(keys(g), ["ada+ben"]);
  assert.deepEqual(g.partial, [{ founderId: "dan", coFounderIds: ["ada"], startupName: null, gaps: [{ kind: "other_team", founderId: "ada" }] }]);
});

check("pas reciproque si un membre cite une equipe differente (de plus ou de moins)", () => {
  const g = groupTeamLocks([yes("ada", ["ben", "chloe"]), yes("ben", ["ada"]), yes("chloe", ["ada", "ben"])]);
  assert.deepEqual(keys(g), []);
  assert.deepEqual(
    g.partial.map((p) => [p.founderId, p.gaps.map((x) => `${x.kind}:${x.founderId}`)]),
    [
      ["ada", ["other_team:ben"]],
      ["ben", ["other_team:ada"]],
      ["chloe", ["other_team:ben"]],
    ],
  );
});

check("un cofondateur qui n'a pas repondu, ou qui a dit non", () => {
  const g = groupTeamLocks([yes("ada", ["ben", "eva"]), no("eva")]);
  assert.deepEqual(keys(g), []);
  assert.deepEqual(g.partial[0].gaps, [{ kind: "not_answered", founderId: "ben" }, { kind: "said_no", founderId: "eva" }]);
  assert.deepEqual(g.noTeam, ["eva"]);
});

check("« oui » sans cofondateur : a verifier, sans equipe proposee", () => {
  const g = groupTeamLocks([yes("ada", [])]);
  assert.deepEqual(keys(g), []);
  assert.deepEqual(g.partial, [{ founderId: "ada", coFounderIds: [], startupName: null, gaps: [] }]);
});

check("se citer soi-meme ou citer deux fois ne change rien", () => {
  const g = groupTeamLocks([yes("ada", ["ben", "ada", "ben"]), yes("ben", ["ada"])]);
  assert.deepEqual(keys(g), ["ada+ben"]);
});

check("un « non » garde ses anciens cofondateurs : ils ne comptent pas", () => {
  const g = groupTeamLocks([{ founderId: "ada", locked: false, coFounderIds: ["ben"], startupName: null }, yes("ben", ["ada"])]);
  assert.deepEqual(keys(g), []);
  assert.deepEqual(g.noTeam, ["ada"]);
  assert.deepEqual(g.partial[0].gaps, [{ kind: "said_no", founderId: "ada" }]);
});

check("deja dans une startup : plus range, son equipe n'est plus proposee", () => {
  const answers = [yes("ada", ["ben"]), yes("ben", ["ada"]), yes("chloe", ["dan"]), yes("dan", ["chloe"])];
  const g = groupTeamLocks(answers, new Set(["ada", "ben"]));
  assert.deepEqual(keys(g), ["chloe+dan"]);
  assert.deepEqual(g.partial, []);
  const half = groupTeamLocks(answers, new Set(["ada"]));
  assert.deepEqual(half.partial[0], { founderId: "ben", coFounderIds: ["ada"], startupName: null, gaps: [{ kind: "has_startup", founderId: "ada" }] });
});

check("une reponse envoyee sans la question (locked null) n'est pas rangee", () => {
  const g = groupTeamLocks([{ founderId: "ada", locked: null, coFounderIds: [], startupName: null }]);
  assert.deepEqual([g.proposed, g.partial, g.noTeam], [[], [], []]);
});

// ---- Creation des startups ----
const founder = (id, extra = {}) => ({ id, batchId: "fall-2026", name: id.toUpperCase(), startupId: null, archivedDateISOString: null, ...extra });
const base = {
  programId: "accelerator",
  batchId: "fall-2026",
  founders: [founder("ada"), founder("ben"), founder("chloe"), founder("dan", { startupId: "old" }), founder("eva", { archivedDateISOString: "2026-11-10T00:00:00.000Z" })],
  existingStartupIds: new Set(["fall-2026-lumen"]),
  dayString: "2026-11-23",
  nowISO: "2026-11-23T18:00:00.000Z",
};

check("creer une startup : la startup, ses profils, une appartenance datee et le startupId par membre", () => {
  const { writes, startupIds } = startupCreationWrites({ ...base, drafts: [{ name: " Lumen ", memberIds: ["ada", "ben"] }] });
  assert.deepEqual(startupIds, ["fall-2026-lumen-2"]); // l'id evite une startup existante
  assert.deepEqual(writes.map((w) => `${w.op} ${w.path}`), [
    "set startups/fall-2026-lumen-2",
    "set startups/fall-2026-lumen-2/private/profile",
    "set startups/fall-2026-lumen-2/private/internal",
    "set memberships/fall-2026-lumen-2_ada_2026-11-23",
    "merge founders/ada",
    "set memberships/fall-2026-lumen-2_ben_2026-11-23",
    "merge founders/ben",
  ]);
  const startup = writes[0].data;
  assert.equal(startup.name, "Lumen");
  assert.deepEqual(startup.memberIds, ["ada", "ben"]);
  assert.equal(startup.status, "active");
  assert.equal(writes[1].data.teamFormedDayString, "2026-11-23");
  assert.deepEqual(writes[3].data, { programId: "accelerator", batchId: "fall-2026", founderId: "ada", kind: "startup", teamId: "fall-2026-lumen-2", eventId: null, role: null, startDayString: "2026-11-23", endDayString: null, endReason: null });
  assert.deepEqual(writes[4].data, { startupId: "fall-2026-lumen-2", updatedDateISOString: base.nowISO });
});

check("deux startups au meme nom dans le meme lot : deux ids", () => {
  const { startupIds } = startupCreationWrites({ ...base, existingStartupIds: new Set(), drafts: [{ name: "Nova", memberIds: ["ada"] }, { name: "nova", memberIds: ["ben"] }] });
  assert.deepEqual(startupIds, ["fall-2026-nova", "fall-2026-nova-2"]);
  assert.equal(startupIdFor("fall-2026", "Élan Vital!", new Set()), "fall-2026-elan-vital");
});

check("refus : nom vide, equipe vide ou trop grande, membre deja dans une startup, archive, inconnu ou cite deux fois", () => {
  const refused = (drafts, code) => assert.throws(() => startupCreationWrites({ ...base, drafts }), (e) => e.code === code);
  refused([{ name: "  ", memberIds: ["ada"] }], "missing_name");
  refused([{ name: "Nova", memberIds: [] }], "no_members");
  refused([{ name: "Nova", memberIds: ["ada", "dan"] }], "already_in_startup");
  refused([{ name: "Nova", memberIds: ["eva"] }], "unknown_founder");
  refused([{ name: "Nova", memberIds: ["zed"] }], "unknown_founder");
  refused([{ name: "Nova", memberIds: ["ada"] }, { name: "Vega", memberIds: ["ada", "ben"] }], "member_twice");
  refused([{ name: "Nova", memberIds: ["a1", "a2", "a3", "a4", "a5", "a6"] }], "too_many_members");
});
